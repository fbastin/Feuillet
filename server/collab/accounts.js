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
//   DELETE /account           {password}                 (token): with the
//                                                        projects it owns
//   GET    /account/projects                             (token) -> {projects}
//   POST   /account/projects  {projects}                 (token) -> {projects}
//   GET    /account/sessions                             (token) -> {sessions}
//   POST   /account/sessions  {revoke: id} | {others: true} (token) -> {sessions}
//   GET    /account/dictionary                           (token) -> {words}
//   POST   /account/dictionary {words}                   (token) -> {words}
//   GET    /account/recovery                             (token) -> {count,
//                                                        createdAt}
//   POST   /account/recovery  {password}                 (token) -> {codes,
//                                                        createdAt}: new codes,
//                                                        shown once
//   POST   /account/recover   {username, code, newPassword} -> {username,
//                                                        remaining}
//   GET    /account/recovery/options                     -> {email}: whether
//                                                        accounts may be
//                                                        recovered by email
//   GET    /account/email                                (token) -> {enabled,
//                                                        address, pending}
//   POST   /account/email     {password, address, language} (token): mails a
//                                                        link confirming it
//   POST   /account/email     {password, remove: true}   (token)
//   POST   /account/email/confirm {token}                -> {address}
//   POST   /account/forgot    {login, language}          -> {sent: true}
//   POST   /account/reset     {token, newPassword}       -> {username}
//
// Recovery by email, as on Overleaf, when the server can send mail
// (mail.js): an account may give an address, kept once confirmed through a
// link mailed to it (24 hours). Forgetting the password, one gives one's
// name or that address, and a link (one hour) lets one choose a new
// password, which signs every device out. Whether an account or address
// exists is not told, and addresses are never logged.
//
// Recovery codes, as GitHub's, for a forgotten password without an email
// address: each opens the account once to choose a new password, which
// signs every device out. Only their hashes are kept.
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
const RECOVERY_CODES = 10;
const EMAIL_CONFIRM_MS = 24 * 60 * 60 * 1000;
const RESET_MS = 60 * 60 * 1000;
// Emails one account may be sent in ATTEMPT_WINDOW_MS.
const MAX_MAILS_PER_ACCOUNT = 3;
const LINK_TOKEN = /^([0-9a-f]{64})\.([A-Za-z0-9_-]{20,100})$/;
// Without letters or digits that look alike: 16 of them, about 79 bits.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
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

const newRecoveryCode = () => {
	const letters = Array.from(
		{ length: 16 },
		() => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)],
	);
	return [0, 4, 8, 12].map((at) => letters.slice(at, at + 4).join('')).join('-');
};
const recoveryHash = (code) =>
	sha256(`recovery:${String(code).toLowerCase().replace(/[^a-z0-9]/g, '')}`);

const normalizeEmail = (value) =>
	typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = (address) =>
	address.length <= 254 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(address);
const sameHash = (a, b) =>
	typeof a === 'string' &&
	a.length === b.length &&
	crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

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
		// Archived or in the trash, as on Overleaf's project list.
		archived: entry.archived === true,
		trashedAt:
			Number.isFinite(Number(entry.trashedAt)) && Number(entry.trashedAt) > 0
				? Number(entry.trashedAt)
				: undefined,
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

// What device signs in, from its browser's User-Agent: the names of the
// browser and of the system only, for the list of devices; neither the
// User-Agent itself nor the address is kept.
const deviceOf = (req) => {
	const agent = String(req.headers?.['user-agent'] ?? '');
	const browser = /Edg(?:e|A|iOS)?\//.test(agent)
		? 'Edge'
		: /OPR\/|Opera/.test(agent)
			? 'Opera'
			: /Firefox\/|FxiOS\//.test(agent)
				? 'Firefox'
				: /Chrome\/|CriOS\//.test(agent)
					? 'Chrome'
					: /Safari\//.test(agent)
						? 'Safari'
						: '';
	const os = /Android/.test(agent)
		? 'Android'
		: /iPhone|iPad|iPod/.test(agent)
			? 'iOS'
			: /Windows/.test(agent)
				? 'Windows'
				: /CrOS/.test(agent)
					? 'ChromeOS'
					: /Mac OS X|Macintosh/.test(agent)
						? 'macOS'
						: /Linux/.test(agent)
							? 'Linux'
							: '';
	return { browser, os };
};

const createAccounts = ({ dir, log, mailer = null, appUrl = '' }) => {
	fs.mkdirSync(dir, { recursive: true });
	// Which account confirmed each recovery address, by a hash of it.
	const emailsDir = path.join(dir, 'emails');
	fs.mkdirSync(emailsDir, { recursive: true });
	const appBase = String(appUrl).replace(/\/+$/, '');

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

	const emailPath = (address) =>
		path.join(emailsDir, `${sha256(`email:${address}`)}.json`);
	const emailOwner = (address) => {
		try {
			return JSON.parse(fs.readFileSync(emailPath(address), 'utf8')).key ?? null;
		} catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
	};
	const setEmailOwner = (address, key) => {
		const target = emailPath(address);
		const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
		fs.writeFileSync(temp, JSON.stringify({ key }), { mode: 0o600 });
		fs.renameSync(temp, target);
	};
	const dropEmailOwner = (address, key) => {
		if (address && emailOwner(address) === key) {
			fs.rmSync(emailPath(address), { force: true });
		}
	};

	// A link's token: the account's key, so that it is found without the
	// session, and a secret, kept as its hash.
	const newLinkToken = (key) => {
		const secret = crypto.randomBytes(32).toString('base64url');
		return { token: `${key}.${secret}`, hash: sha256(secret) };
	};
	const parseLinkToken = (token) => {
		const match = LINK_TOKEN.exec(typeof token === 'string' ? token : '');
		return match ? { key: match[1], hash: sha256(match[2]) } : null;
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

	const openSession = (account, key, device = {}) => {
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
			...(device.browser || device.os ? { device } : {}),
		};
		account.lastUsedAt = now;
		return `${key}.${secret}`;
	};

	// The devices signed in to an account, as Overleaf's sessions: this one
	// first, then the most recently used. Each has an id of its own, not the
	// stored hash of its token.
	const deviceId = (sessionKey) =>
		sha256(`device:${sessionKey}`).slice(0, 24);
	const listSessions = (account, current) => {
		const now = Date.now();
		return Object.entries(account.sessions ?? {})
			.filter(([, session]) => session.expiresAt > now)
			.map(([sessionKey, session]) => ({
				id: deviceId(sessionKey),
				current: sessionKey === current,
				createdAt: session.createdAt,
				lastUsedAt: session.lastUsedAt,
				...(session.device?.browser ? { browser: session.device.browser } : {}),
				...(session.device?.os ? { os: session.device.os } : {}),
			}))
			.sort(
				(a, b) =>
					Number(b.current) - Number(a.current) || b.lastUsedAt - a.lastUsedAt,
			);
	};

	const getSessions = (req) =>
		authenticate(req, (account, sessionId) => ({
			body: { sessions: listSessions(account, sessionId) },
		}));

	// Signs out another device, or all the others; this one signs out with
	// /account/logout.
	const endSessions = (req, body) =>
		authenticate(req, (account, sessionId) => {
			const others = body.others === true;
			const revoke = typeof body.revoke === 'string' ? body.revoke : null;
			if (!others && !revoke) throw new HttpError(400, 'invalid_request');
			account.sessions = Object.fromEntries(
				Object.entries(account.sessions ?? {}).filter(
					([sessionKey]) =>
						sessionKey === sessionId ||
						(!others && deviceId(sessionKey) !== revoke),
				),
			);
			return {
				changed: true,
				body: { sessions: listSessions(account, sessionId) },
			};
		});

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
				// Kept after signing out, for the administration page.
				account.lastUsedAt = Math.max(account.lastUsedAt ?? 0, now);
				write(key, account);
			}
			return result?.body;
		});
	};

	// Who owns each project, from the project links (shares.js): told with
	// every list, never stored with it.
	let describeProject = () => ({});
	const setProjectDescriber = (describe) => {
		describeProject = describe;
	};

	const listProjects = (account) =>
		Object.values(account.projects ?? {})
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((entry) =>
				entry.deleted
					? entry
					: { ...entry, ...describeProject(idOf(account), entry) },
			);

	const register = async (body, ip, device) => {
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
			const token = openSession(account, key, device);
			write(key, account);
			log('account created', JSON.stringify(username));
			return { username, token };
		});
	};

	const login = async (body, ip, device) => {
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
			const token = openSession(current, key, device);
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
			delete account.reset;
			// Other devices sign in again with the new password.
			account.sessions = { [sessionId]: account.sessions[sessionId] };
			return { changed: true };
		});

	// How many recovery codes are left, and when they were made.
	const getRecovery = (req) =>
		authenticate(req, (account) => ({
			body: {
				count: account.recovery?.codes?.length ?? 0,
				...(account.recovery?.createdAt
					? { createdAt: account.recovery.createdAt }
					: {}),
			},
		}));

	// New recovery codes, replacing those there were; shown only now.
	const createRecovery = (req, body) =>
		authenticate(req, async (account) => {
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
			const createdAt = Date.now();
			account.recovery = { createdAt, codes: codes.map(recoveryHash) };
			log('recovery codes made');
			return { changed: true, body: { codes, createdAt } };
		});

	// A forgotten password: a recovery code, used up, lets the account
	// choose a new one. Every device signs in again, and what was granted
	// with the old password ends (stampOf).
	const recover = async (body, ip) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const username = normalizeUsername(body.username);
		if (!validPassword(body.newPassword)) {
			throw new HttpError(400, 'invalid_password');
		}
		if (!validUsername(username) || typeof body.code !== 'string') {
			throw new HttpError(401, 'invalid_recovery');
		}
		const key = keyOf(username);
		limit(`failures:${key}`, MAX_FAILURES_PER_ACCOUNT);
		const passwordHash = await hashPassword(body.newPassword);
		const hash = recoveryHash(body.code);
		const recovered = await withAccount(key, (account) => {
			const codes = account?.recovery?.codes ?? [];
			if (!codes.includes(hash)) throw new HttpError(401, 'invalid_recovery');
			account.recovery = {
				...account.recovery,
				codes: codes.filter((stored) => stored !== hash),
			};
			account.passwordHash = passwordHash;
			account.sessions = {};
			delete account.reset;
			write(key, account);
			return {
				username: account.username,
				remaining: account.recovery.codes.length,
			};
		});
		clearFailures(key);
		log('account recovered');
		return recovered;
	};

	const emailStatus = (account) => {
		const pending = account.emailToken;
		return {
			enabled: Boolean(mailer),
			...(account.email?.address ? { address: account.email.address } : {}),
			...(pending && pending.expiresAt > Date.now()
				? { pending: pending.address }
				: {}),
		};
	};

	const getEmail = (req) =>
		authenticate(req, (account) => ({ body: emailStatus(account) }));

	// The address an account may be recovered with, once confirmed through
	// a link mailed to it; or none any more.
	const setEmail = (req, body) =>
		authenticate(req, async (account) => {
			if (!mailer) throw new HttpError(404, 'mail_disabled');
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			const key = keyOf(account.username);
			if (body.remove === true) {
				dropEmailOwner(account.email?.address, key);
				delete account.email;
				delete account.emailToken;
				log('recovery address removed');
				return { changed: true, body: emailStatus(account) };
			}
			const address = normalizeEmail(body.address);
			if (!validEmail(address)) throw new HttpError(400, 'invalid_email');
			const owner = emailOwner(address);
			if (owner && owner !== key) throw new HttpError(409, 'email_taken');
			if (account.email?.address === address) {
				delete account.emailToken;
				return { changed: true, body: emailStatus(account) };
			}
			limit(`mail:${key}`, MAX_MAILS_PER_ACCOUNT);
			const { token, hash } = newLinkToken(key);
			try {
				await mailer.send('confirm', {
					to: address,
					language: body.language,
					username: account.username,
					link: `${appBase}/#confirm-email:${token}`,
				});
			} catch {
				throw new HttpError(502, 'mail_failed');
			}
			account.emailToken = {
				address,
				hash,
				expiresAt: Date.now() + EMAIL_CONFIRM_MS,
			};
			log('recovery address to confirm');
			return { changed: true, body: emailStatus(account) };
		});

	// The link mailed to confirm an address; it may be opened on any device.
	const confirmEmail = async (body, ip) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const parsed = parseLinkToken(body.token);
		if (!parsed) throw new HttpError(400, 'invalid_token');
		return withAccount(parsed.key, (account) => {
			const pending = account?.emailToken;
			if (
				!pending ||
				!sameHash(pending.hash, parsed.hash) ||
				pending.expiresAt <= Date.now()
			) {
				throw new HttpError(410, 'expired_token');
			}
			const owner = emailOwner(pending.address);
			if (owner && owner !== parsed.key) {
				throw new HttpError(409, 'email_taken');
			}
			if (account.email?.address !== pending.address) {
				dropEmailOwner(account.email?.address, parsed.key);
			}
			setEmailOwner(pending.address, parsed.key);
			account.email = { address: pending.address, confirmedAt: Date.now() };
			delete account.emailToken;
			write(parsed.key, account);
			log('recovery address confirmed');
			return { address: account.email.address };
		});
	};

	// A forgotten password, by the account's name or its recovery address:
	// a link to choose a new one goes to that address. The answer is the
	// same, and as quick, whether or not there is such an account.
	const forgot = async (body, ip) => {
		if (!mailer) throw new HttpError(404, 'mail_disabled');
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const login = typeof body.login === 'string' ? body.login.trim() : '';
		if (!login || login.length > 254) throw new HttpError(400, 'invalid_login');
		const name = normalizeUsername(login);
		const key = login.includes('@')
			? emailOwner(normalizeEmail(login))
			: validUsername(name)
				? keyOf(name)
				: null;
		if (key) {
			void withAccount(key, async (account) => {
				const address = account?.email?.address;
				if (!address) return;
				limit(`mail:${key}`, MAX_MAILS_PER_ACCOUNT);
				const { token, hash } = newLinkToken(key);
				await mailer.send('reset', {
					to: address,
					language: body.language,
					username: account.username,
					link: `${appBase}/#reset-password:${token}`,
				});
				account.reset = { hash, expiresAt: Date.now() + RESET_MS };
				write(key, account);
			}).catch(() => {});
		}
		return { sent: true };
	};

	// The link mailed for a forgotten password: a new one, and every device
	// signs in again.
	const resetPassword = async (body, ip) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		if (!validPassword(body.newPassword)) {
			throw new HttpError(400, 'invalid_password');
		}
		const parsed = parseLinkToken(body.token);
		if (!parsed) throw new HttpError(400, 'invalid_token');
		const passwordHash = await hashPassword(body.newPassword);
		const username = await withAccount(parsed.key, (account) => {
			const pending = account?.reset;
			if (
				!pending ||
				!sameHash(pending.hash, parsed.hash) ||
				pending.expiresAt <= Date.now()
			) {
				throw new HttpError(410, 'expired_token');
			}
			account.passwordHash = passwordHash;
			account.sessions = {};
			delete account.reset;
			write(parsed.key, account);
			return account.username;
		});
		clearFailures(parsed.key);
		log('password reset by email');
		return { username };
	};

	// What goes with an account: the projects it owns, its memberships
	// (shares.js). Set by the server.
	let accountDeleted = async () => {};
	const setAccountDeleted = (handler) => {
		accountDeleted = handler;
	};

	// What goes before an account's file: its projects, its memberships, its
	// address.
	const forget = async (account) => {
		await accountDeleted(idOf(account));
		dropEmailOwner(account.email?.address, keyOf(account.username));
	};

	const deleteAccount = (req, body) =>
		authenticate(req, async (account) => {
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			await forget(account);
			log('account deleted', JSON.stringify(account.username));
			return { deleted: true };
		});

	// Deletes an account as DELETE /account does, without its password, for
	// the administration page (admin.js): `username` must still be its name.
	const removeAccount = (id, username) => {
		const [key, createdAt] = String(id).split('.');
		if (!/^[0-9a-f]{64}$/.test(key ?? '')) {
			throw new HttpError(404, 'unknown_account');
		}
		return withAccount(key, async (account) => {
			if (!account || String(account.createdAt) !== createdAt) {
				throw new HttpError(404, 'unknown_account');
			}
			if (account.username !== username) {
				throw new HttpError(409, 'wrong_username');
			}
			await forget(account);
			fs.rmSync(accountPath(key), { force: true });
			return account.username;
		});
	};

	// Every account, for the administration page (admin.js): its name, when
	// it was made and last used, its devices, whether its email address is
	// confirmed, and how many projects it lists; never the address, the
	// password or the projects.
	const summaries = () => {
		const now = Date.now();
		const list = [];
		for (const file of fs.readdirSync(dir)) {
			if (!/^[0-9a-f]{64}\.json$/.test(file)) continue;
			let account;
			try {
				account = read(file.slice(0, -5));
			} catch {
				continue;
			}
			if (!account?.username) continue;
			const sessions = Object.values(account.sessions ?? {}).filter(
				(session) => session.expiresAt > now,
			);
			const lastUsedAt = Math.max(
				Number(account.lastUsedAt) || 0,
				...sessions.map((session) => Number(session.lastUsedAt) || 0),
			);
			list.push({
				id: idOf(account),
				username: account.username,
				createdAt: account.createdAt,
				...(lastUsedAt > 0 ? { lastUsedAt } : {}),
				devices: sessions.length,
				email: account.email?.address
					? 'confirmed'
					: account.emailToken?.expiresAt > now
						? 'pending'
						: 'none',
				listed: Object.values(account.projects ?? {}).filter(
					(entry) => !entry.deleted,
				).length,
			});
		}
		return list;
	};

	// An id for an account that a new account with the same name will not
	// have.
	const idOf = (account) => `${keyOf(account.username)}.${account.createdAt}`;

	// Changes with the password, so that what was granted with the old one
	// ends with it, as other devices are signed out.
	const stampOf = (account) => sha256(String(account.passwordHash)).slice(0, 16);

	// Checks a username and password as signing in does, without opening a
	// session: for letting an application use the account (oauth.js).
	const verifyCredentials = async (username, password, ip) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const name = normalizeUsername(username);
		if (!validUsername(name) || typeof password !== 'string') {
			throw new HttpError(400, 'invalid_credentials');
		}
		const key = keyOf(name);
		const account = read(key);
		if (!account) throw new HttpError(404, 'unknown_username');
		limit(`failures:${key}`, MAX_FAILURES_PER_ACCOUNT);
		if (!(await checkPassword(password, account.passwordHash))) {
			throw new HttpError(401, 'wrong_password');
		}
		clearFailures(key);
		return {
			id: idOf(account),
			username: account.username,
			stamp: stampOf(account),
		};
	};

	// The account with this id and its projects, or null when it was deleted
	// or made again.
	const accountById = (id) => {
		const [key, createdAt] = String(id).split('.');
		if (!/^[0-9a-f]{64}$/.test(key ?? '')) return null;
		const account = read(key);
		if (!account || String(account.createdAt) !== createdAt) return null;
		return {
			id,
			username: account.username,
			stamp: stampOf(account),
			projects: listProjects(account).filter((entry) => !entry.deleted),
		};
	};

	// Who sent a request.
	const identify = (req) =>
		authenticate(req, (account) => ({ body: idOf(account) }));

	// The username of the account with this id, or null.
	const usernameOf = (id) => {
		const [key, createdAt] = String(id).split('.');
		if (!/^[0-9a-f]{64}$/.test(key ?? '')) return null;
		const account = read(key);
		return account && String(account.createdAt) === createdAt
			? account.username
			: null;
	};

	// Whether an account's email address is confirmed: Feuillet mails its
	// invitations only then, so that whoever makes accounts cannot have it
	// mail anyone.
	const hasConfirmedEmail = (id) => {
		const [key, createdAt] = String(id).split('.');
		if (!/^[0-9a-f]{64}$/.test(key ?? '')) return false;
		const account = read(key);
		return Boolean(
			account &&
				String(account.createdAt) === createdAt &&
				account.email?.address,
		);
	};

	// The account with this username, or null.
	const findAccount = (username) => {
		const name = normalizeUsername(username);
		if (!validUsername(name)) return null;
		const account = read(keyOf(name));
		return account ? { id: idOf(account), username: account.username } : null;
	};

	// Adds a project shared with an account to its list, so that its devices
	// show it.
	const shareProject = (username, entry) => {
		const key = keyOf(normalizeUsername(username));
		return withAccount(key, (account) => {
			if (!account) return;
			// Shared again after leaving it: newer than the removal.
			const removed = account.projects?.[entry.id];
			const updatedAt = removed?.deleted
				? Math.max(entry.updatedAt, removed.updatedAt + 1)
				: entry.updatedAt;
			account.projects = mergeProjects(account.projects ?? {}, [
				{ ...entry, updatedAt },
			]);
			write(key, account);
		});
	};

	// Takes projects off an account's list, on all its devices: those of a
	// shared project it left or was removed from. `matches` tells them.
	const unshareProject = (username, matches) => {
		const key = keyOf(normalizeUsername(username));
		return withAccount(key, (account) => {
			if (!account) return 0;
			const now = Date.now();
			let removed = 0;
			for (const [id, entry] of Object.entries(account.projects ?? {})) {
				if (entry.deleted || !matches(entry)) continue;
				// Newer than the entry, so that every device takes it.
				account.projects[id] = {
					id,
					updatedAt: Math.max(now, entry.updatedAt + 1),
					deleted: true,
				};
				removed++;
			}
			if (removed) write(key, account);
			return removed;
		});
	};

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
			register(body, clientAddress(req), deviceOf(req)),
		'POST /account/login': (req, body) =>
			login(body, clientAddress(req), deviceOf(req)),
		'GET /account/sessions': (req) => getSessions(req),
		'POST /account/sessions': (req, body) => endSessions(req, body),
		'POST /account/logout': (req) => logout(req),
		'POST /account/password': (req, body) => changePassword(req, body),
		'DELETE /account': (req, body) => deleteAccount(req, body),
		'GET /account/projects': (req) => getProjects(req),
		'POST /account/projects': (req, body) => syncProjects(req, body),
		'GET /account/dictionary': (req) => getDictionary(req),
		'POST /account/dictionary': (req, body) => syncDictionary(req, body),
		'GET /account/recovery': (req) => getRecovery(req),
		'POST /account/recovery': (req, body) => createRecovery(req, body),
		'POST /account/recover': (req, body) => recover(body, clientAddress(req)),
		'GET /account/recovery/options': () => ({ email: Boolean(mailer) }),
		'GET /account/email': (req) => getEmail(req),
		'POST /account/email': (req, body) => setEmail(req, body),
		'POST /account/email/confirm': (req, body) =>
			confirmEmail(body, clientAddress(req)),
		'POST /account/forgot': (req, body) => forgot(body, clientAddress(req)),
		'POST /account/reset': (req, body) =>
			resetPassword(body, clientAddress(req)),
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

	return {
		handles,
		handle,
		identify,
		verifyCredentials,
		accountById,
		clientAddress,
		findAccount,
		usernameOf,
		hasConfirmedEmail,
		summaries,
		removeAccount,
		shareProject,
		unshareProject,
		setProjectDescriber,
		setAccountDeleted,
	};
};

module.exports = {
	createAccounts,
	deviceOf,
	mergeProjects,
	cleanProject,
	mergeWords,
	cleanWord,
};
