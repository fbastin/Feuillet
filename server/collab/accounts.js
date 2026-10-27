// server/collab/accounts.js
// Feuillet accounts: a username, a password, the list of the account's
// projects and the words of its spelling dictionary, so that signing in on
// another device shows the same projects and accepts the same words, as on
// Overleaf. Project contents stay in the shared documents and files; an
// account only lists them.
//
// Each account is one JSON file in ACCOUNTS_DIR, named after a hash of the
// lower-case username. Passwords are kept as scrypt hashes and sessions as
// SHA-256 hashes of their tokens.
//
//   POST   /account/register  {username, password}       -> {username, token}
//   POST   /account/login     {username, password}       -> {username, token}
//   POST   /account/logout                               (token)
//   POST   /account/password  {password, newPassword}    (token)
//   DELETE /account           {password}                 (token)
//   GET    /account/projects                             (token) -> {projects}
//   POST   /account/projects  {projects}                 (token) -> {projects}
//   GET    /account/dictionary                           (token) -> {words}
//   POST   /account/dictionary {words}                   (token) -> {words}
//
// The token goes in an `Authorization: Bearer` header.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 50;
const MAX_PROJECTS = 5000;
const MAX_WORDS = 10000;
const MAX_BODY_BYTES = 1024 * 1024;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 30;
const MAX_FAILURES_PER_ACCOUNT = 10;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,100}$/;
// Words as the spell checker finds them: letters, with the apostrophes,
// hyphens and middle dots inside words.
const WORD = /^[\p{L}\p{M}'’·-]{1,100}$/u;

class HttpError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const normalizeUsername = (value) =>
	typeof value === 'string' ? value.trim() : '';

const validUsername = (username) =>
	username.length >= 1 &&
	username.length <= 64 &&
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejects them.
	!/[\u0000-\u001f\u007f]/.test(username);

const validPassword = (password) =>
	typeof password === 'string' &&
	password.length >= 6 &&
	password.length <= 256;

const scrypt = (password, salt) =>
	new Promise((resolve, reject) => {
		const { N, r, p, keylen } = SCRYPT;
		crypto.scrypt(
			password,
			salt,
			keylen,
			{ N, r, p, maxmem: 64 * 1024 * 1024 },
			(error, key) => (error ? reject(error) : resolve(key)),
		);
	});

const hashPassword = async (password) => {
	const salt = crypto.randomBytes(16);
	const key = await scrypt(password, salt);
	const { N, r, p } = SCRYPT;
	return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
};

const checkPassword = async (password, stored) => {
	const [scheme, , , , salt, key] = String(stored).split('$');
	if (scheme !== 'scrypt' || !salt || !key) return false;
	const expected = Buffer.from(key, 'base64');
	const actual = await scrypt(password, Buffer.from(salt, 'base64'));
	return (
		actual.length === expected.length &&
		crypto.timingSafeEqual(actual, expected)
	);
};

const text = (value, max) =>
	typeof value === 'string' ? value.slice(0, max) : undefined;

// Keeps the fields that describe a project in a list; the rest (last opened
// file, disk links) belongs to each device.
const cleanProject = (entry) => {
	if (!entry || typeof entry !== 'object') return null;
	if (typeof entry.id !== 'string' || !PROJECT_ID.test(entry.id)) return null;
	const updatedAt = Number(entry.updatedAt);
	if (!Number.isFinite(updatedAt)) return null;

	if (entry.deleted === true) return { id: entry.id, updatedAt, deleted: true };

	return {
		id: entry.id,
		docUrl: text(entry.docUrl, 300) ?? `yjs:${entry.id}`,
		// The id the project opens under since its editing link was replaced.
		editId:
			typeof entry.editId === 'string' && PROJECT_ID.test(entry.editId)
				? entry.editId
				: undefined,
		name: text(entry.name, 300) ?? '',
		description: text(entry.description, 5000) ?? '',
		type: text(entry.type, 50) ?? 'latex',
		group: text(entry.group, 50),
		compilerId: text(entry.compilerId, 100),
		tags: Array.isArray(entry.tags)
			? entry.tags
					.filter((tag) => typeof tag === 'string')
					.slice(0, 50)
					.map((tag) => tag.slice(0, 100))
			: [],
		isFavorite: entry.isFavorite === true,
		createdAt: Number.isFinite(Number(entry.createdAt))
			? Number(entry.createdAt)
			: updatedAt,
		updatedAt,
	};
};

// A word added to the dictionary, or removed from it.
const cleanWord = (entry) => {
	if (!entry || typeof entry !== 'object') return null;
	if (typeof entry.word !== 'string' || !WORD.test(entry.word)) return null;
	const updatedAt = Number(entry.updatedAt);
	if (!Number.isFinite(updatedAt)) return null;
	return entry.deleted === true
		? { word: entry.word, updatedAt, deleted: true }
		: { word: entry.word, updatedAt };
};

// The most recent version of each entry wins; a deletion is a version too,
// so that other devices remove the entry as well.
const mergeLatest = (stored, incoming, clean, keyOf) => {
	const merged = { ...stored };
	for (const raw of incoming) {
		const entry = clean(raw);
		if (!entry) continue;
		const key = keyOf(entry);
		if (key === '__proto__') continue;
		const current = Object.hasOwn(merged, key) ? merged[key] : undefined;
		if (
			!current ||
			entry.updatedAt > current.updatedAt ||
			(entry.updatedAt === current.updatedAt && entry.deleted)
		) {
			merged[key] = entry;
		}
	}
	return merged;
};

const mergeProjects = (stored, incoming) =>
	mergeLatest(stored, incoming, cleanProject, (entry) => entry.id);

const mergeWords = (stored, incoming) =>
	mergeLatest(stored, incoming, cleanWord, (entry) => entry.word);

const createAccounts = ({ dir, log }) => {
	fs.mkdirSync(dir, { recursive: true });

	const accountPath = (key) => path.join(dir, `${key}.json`);
	const keyOf = (username) => sha256(username.toLowerCase());
	const queues = new Map();
	const attempts = new Map();

	const read = (key) => {
		try {
			return JSON.parse(fs.readFileSync(accountPath(key), 'utf8'));
		} catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
	};

	const write = (key, account) => {
		const target = accountPath(key);
		const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
		fs.writeFileSync(temp, JSON.stringify(account), { mode: 0o600 });
		fs.renameSync(temp, target);
	};

	// Changes to one account run one after the other.
	const withAccount = (key, change) => {
		const previous = queues.get(key) ?? Promise.resolve();
		const next = previous.then(() => change(read(key)));
		const settled = next.catch(() => {});
		queues.set(key, settled);
		settled.then(() => {
			if (queues.get(key) === settled) queues.delete(key);
		});
		return next;
	};

	const limit = (bucket, max) => {
		const now = Date.now();
		const recent = (attempts.get(bucket) ?? []).filter(
			(time) => now - time < ATTEMPT_WINDOW_MS,
		);
		if (recent.length >= max) throw new HttpError(429, 'too_many_attempts');
		recent.push(now);
		attempts.set(bucket, recent);
	};

	const clearFailures = (key) => attempts.delete(`failures:${key}`);

	setInterval(() => {
		const now = Date.now();
		for (const [bucket, times] of attempts) {
			if (times.every((time) => now - time >= ATTEMPT_WINDOW_MS)) {
				attempts.delete(bucket);
			}
		}
	}, ATTEMPT_WINDOW_MS).unref();

	const openSession = (account, key) => {
		const secret = crypto.randomBytes(32).toString('base64url');
		const now = Date.now();
		const sessions = Object.entries(account.sessions ?? {})
			.filter(([, session]) => session.expiresAt > now)
			.sort(([, a], [, b]) => b.lastUsedAt - a.lastUsedAt)
			.slice(0, MAX_SESSIONS - 1);
		account.sessions = Object.fromEntries(sessions);
		account.sessions[sha256(secret)] = {
			createdAt: now,
			lastUsedAt: now,
			expiresAt: now + SESSION_MS,
		};
		return `${key}.${secret}`;
	};

	// Finds the account and session a request's token belongs to, and keeps
	// a session in use from expiring.
	const authenticate = (req, change) => {
		const match = /^Bearer ([0-9a-f]{64})\.([A-Za-z0-9_-]{20,100})$/.exec(
			req.headers.authorization ?? '',
		);
		if (!match) throw new HttpError(401, 'signed_out');
		const [, key, secret] = match;
		const sessionId = sha256(secret);

		return withAccount(key, async (account) => {
			const session = account?.sessions?.[sessionId];
			const now = Date.now();
			if (!session || session.expiresAt <= now) {
				throw new HttpError(401, 'signed_out');
			}
			const result = await change(account, sessionId);
			if (result?.deleted) {
				fs.rmSync(accountPath(key), { force: true });
				return result.body;
			}
			if (result?.changed || now - session.lastUsedAt > SESSION_TOUCH_MS) {
				if (account.sessions[sessionId]) {
					account.sessions[sessionId].lastUsedAt = now;
					account.sessions[sessionId].expiresAt = now + SESSION_MS;
				}
				write(key, account);
			}
			return result?.body;
		});
	};

	const listProjects = (account) =>
		Object.values(account.projects ?? {}).sort(
			(a, b) => b.updatedAt - a.updatedAt,
		);

	const register = async (body, ip) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const username = normalizeUsername(body.username);
		if (!validUsername(username)) throw new HttpError(400, 'invalid_username');
		if (!validPassword(body.password)) {
			throw new HttpError(400, 'invalid_password');
		}
		const key = keyOf(username);
		const passwordHash = await hashPassword(body.password);

		return withAccount(key, (existing) => {
			if (existing) throw new HttpError(409, 'username_taken');
			const account = {
				username,
				passwordHash,
				createdAt: Date.now(),
				projects: {},
				sessions: {},
			};
			const token = openSession(account, key);
			write(key, account);
			log('account created', JSON.stringify(username));
			return { username, token };
		});
	};

	const login = async (body, ip) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const username = normalizeUsername(body.username);
		if (!validUsername(username) || typeof body.password !== 'string') {
			throw new HttpError(400, 'invalid_credentials');
		}
		const key = keyOf(username);
		const account = read(key);
		if (!account) throw new HttpError(404, 'unknown_username');
		limit(`failures:${key}`, MAX_FAILURES_PER_ACCOUNT);
		if (!(await checkPassword(body.password, account.passwordHash))) {
			throw new HttpError(401, 'wrong_password');
		}
		clearFailures(key);

		return withAccount(key, (current) => {
			if (!current) throw new HttpError(404, 'unknown_username');
			const token = openSession(current, key);
			write(key, current);
			return { username: current.username, token };
		});
	};

	const logout = (req) =>
		authenticate(req, (account, sessionId) => {
			delete account.sessions[sessionId];
			return { changed: true };
		});

	const changePassword = (req, body) =>
		authenticate(req, async (account, sessionId) => {
			if (!validPassword(body.newPassword)) {
				throw new HttpError(400, 'invalid_password');
			}
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			account.passwordHash = await hashPassword(body.newPassword);
			// Other devices sign in again with the new password.
			account.sessions = { [sessionId]: account.sessions[sessionId] };
			return { changed: true };
		});

	const deleteAccount = (req, body) =>
		authenticate(req, async (account) => {
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			log('account deleted', JSON.stringify(account.username));
			return { deleted: true };
		});

	// Who sent a request: an id for the account that a new account with the
	// same name will not have.
	const identify = (req) =>
		authenticate(req, (account) => ({
			body: `${keyOf(account.username)}.${account.createdAt}`,
		}));

	const getProjects = (req) =>
		authenticate(req, (account) => ({
			body: { projects: listProjects(account) },
		}));

	const syncProjects = (req, body) =>
		authenticate(req, (account) => {
			if (!Array.isArray(body.projects)) {
				throw new HttpError(400, 'invalid_projects');
			}
			const merged = mergeProjects(account.projects ?? {}, body.projects);
			if (Object.keys(merged).length > MAX_PROJECTS) {
				throw new HttpError(413, 'too_many_projects');
			}
			account.projects = merged;
			return { changed: true, body: { projects: listProjects(account) } };
		});

	const listWords = (account) => Object.values(account.dictionary ?? {});

	const getDictionary = (req) =>
		authenticate(req, (account) => ({
			body: { words: listWords(account) },
		}));

	const syncDictionary = (req, body) =>
		authenticate(req, (account) => {
			if (!Array.isArray(body.words)) {
				throw new HttpError(400, 'invalid_words');
			}
			const merged = mergeWords(account.dictionary ?? {}, body.words);
			if (Object.keys(merged).length > MAX_WORDS) {
				throw new HttpError(413, 'too_many_words');
			}
			const changed =
				JSON.stringify(merged) !== JSON.stringify(account.dictionary ?? {});
			account.dictionary = merged;
			return { changed, body: { words: listWords(account) } };
		});

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			let size = 0;
			const chunks = [];
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					reject(new HttpError(413, 'too_large'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				if (size === 0) {
					resolve({});
					return;
				}
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
					resolve(body && typeof body === 'object' ? body : {});
				} catch {
					reject(new HttpError(400, 'invalid_json'));
				}
			});
			req.on('error', () => reject(new HttpError(400, 'interrupted')));
		});

	// Apache appends the address it received the request from.
	const clientAddress = (req) =>
		String(req.headers['x-forwarded-for'] ?? '')
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
			.pop() ?? req.socket.remoteAddress;

	const routes = {
		'POST /account/register': (req, body) =>
			register(body, clientAddress(req)),
		'POST /account/login': (req, body) => login(body, clientAddress(req)),
		'POST /account/logout': (req) => logout(req),
		'POST /account/password': (req, body) => changePassword(req, body),
		'DELETE /account': (req, body) => deleteAccount(req, body),
		'GET /account/projects': (req) => getProjects(req),
		'POST /account/projects': (req, body) => syncProjects(req, body),
		'GET /account/dictionary': (req) => getDictionary(req),
		'POST /account/dictionary': (req, body) => syncDictionary(req, body),
	};

	const handles = (url) => url === '/account' || url.startsWith('/account/');

	const handle = async (req, res, url) => {
		const route = routes[`${req.method} ${url}`];
		const reply = (status, body) => {
			res.writeHead(status, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			});
			res.end(body === undefined ? '' : JSON.stringify(body));
		};

		if (!route) {
			req.resume();
			reply(404, { error: 'not_found' });
			return;
		}
		try {
			const body = req.method === 'GET' ? {} : await readBody(req);
			const result = await route(req, body);
			reply(result === undefined ? 204 : 200, result);
		} catch (error) {
			if (error instanceof HttpError) {
				reply(error.status, { error: error.code });
				return;
			}
			log('account request failed', error);
			reply(500, { error: 'server_error' });
		}
	};

	return { handles, handle, identify };
};

module.exports = {
	createAccounts,
	mergeProjects,
	cleanProject,
	mergeWords,
	cleanWord,
};
