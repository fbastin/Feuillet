// server/collab/accounts.js
// Feuillet accounts: a username, a password, the list of the account's
// projects, the words of its spelling dictionary and its preferences (the
// editor's settings, the Git commit email...), so that signing in on another
// device shows the same projects, accepts the same words and looks the same,
// as on Overleaf. Project contents stay in the shared documents and files; an
// account only lists them.
//
// Each account is one JSON file in ACCOUNTS_DIR, named after a hash of the
// lower-case username. Passwords are kept as scrypt hashes and sessions as
// SHA-256 hashes of their tokens. A change to how an account is signed in
// to or recovered is told at its address, as Overleaf's security emails
// (tellOwner, mail.js).
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
//   GET    /account/preferences                          (token) -> {entries}
//   POST   /account/preferences {entries}                (token) -> {entries}:
//                                                        each {key, value,
//                                                        updatedAt}, the
//                                                        latest of each key
//                                                        kept; the server
//                                                        does not read them
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
//   GET    /account/git-tokens                           (token) -> {tokens}
//   POST   /account/git-tokens {password, label}         (token) -> {token,
//                                                        tokens}: a new Git
//                                                        token, shown once
//   POST   /account/git-tokens {revoke: id}              (token) -> {tokens}
//   POST   /account/password/verify {password}           (token): 204 when it
//                                                        is the password
//   GET    /account/google                               (token) -> {enabled,
//                                                        linked, linkedAt}
//   POST   /account/google    {password, ticket}         (token): links the
//                                                        Google account
//   POST   /account/google    {password, remove: true}   (token)
//   POST   /account/google/login {ticket}                -> {username, token}
//   GET, POST /account/orcid, POST /account/orcid/login  the same for ORCID
//   GET    /account/two-factor                           (token) -> {enabled,
//                                                        enabledAt,
//                                                        recoveryCodes}
//   POST   /account/two-factor {password}                (token) -> {secret,
//                                                        uri}: a new secret
//                                                        for an app, to
//                                                        confirm within 15
//                                                        minutes
//   POST   /account/two-factor {code}                    (token) -> {enabled,
//                                                        enabledAt, codes?}:
//                                                        on, once a code of
//                                                        it is right; with
//                                                        recovery codes made
//                                                        then if there were
//                                                        none, shown once
//   POST   /account/two-factor {password, code, remove: true} (token): off
//   GET    /account/sign-up                              -> {mode, domains}
//   POST   /account/sign-up   {email, language}          -> {sent: true}: a
//                                                        link to create an
//                                                        account, mailed to
//                                                        an address of the
//                                                        domains allowed
//
// Who may create an account (SIGN_UP, read by server.js): anyone ("open",
// the default), or only with an invitation ("invitation"), as an Overleaf
// Server whose accounts its administrator makes: a personal invitation to a
// project (shares.js), which the account accepts once made; a link to make
// an account, from an administrator (admin.js); or, for the addresses of
// SIGN_UP_DOMAINS, such as a university's, a link mailed to the address,
// which becomes the account's, confirmed. POST /account/register then takes
// {invite} or {signup}, the token of the link. Each link to make an account
// makes one, within 7 days (24 hours mailed); only its hash is kept.
//
// Sign in with Google or ORCID, as on Overleaf (google.js, orcid.js): an
// account may be linked to one account of each, then opened with it; or
// created linked to one, with a password still, which encrypts what the
// browser keeps and confirms what changes the account. Of that account,
// only a hash of its identifier is kept, not its address nor its name.
// POST /account/register takes {username, password, googleTicket} (or
// orcidTicket) to create an account linked to it.
//
// Git tokens, as Overleaf's Git authentication tokens: Git gives one, with
// the account's name, to clone, pull and push its projects (git.js), never
// the password. Only their hashes are kept; changing the password ends them,
// as it signs the other devices out.
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
// Two-factor authentication, as Overleaf's: once on, signing in on a device
// (with the password, Google or ORCID, or to let an application work on the
// projects, oauth.js) also takes the code of an authenticator app (totp.js),
// each accepted once, or one of the recovery codes, used up. Without it,
// /account/login and the others answer `code_required` (the password was
// right) or `wrong_code`; the devices signed in already stay. A password
// reset by email or recovery code leaves it on.
//
// The token goes in an `Authorization: Bearer` header.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const totp = require('./totp');

const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 50;
const MAX_PROJECTS = 5000;
const MAX_WORDS = 10000;
const MAX_PREFERENCES = 300;
// The JSON of one preference's value.
const MAX_PREFERENCE_CHARS = 4096;
const MAX_BODY_BYTES = 1024 * 1024;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 30;
const MAX_FAILURES_PER_ACCOUNT = 10;
const RECOVERY_CODES = 10;
const MAX_GIT_TOKENS = 10;
// Wrong Git tokens let through in 15 minutes, by address and by account;
// right ones are not counted, as Git sends one with each request.
const MAX_GIT_FAILURES_PER_IP = 30;
const MAX_GIT_FAILURES_PER_ACCOUNT = 10;
const GIT_TOKEN = /^fgt_[A-Za-z0-9_-]{43}$/;
// Writing when a token was last used, at most this often.
const GIT_TOUCH_MS = 60 * 60 * 1000;
const EMAIL_CONFIRM_MS = 24 * 60 * 60 * 1000;
// The time to confirm a new authenticator app with one of its codes.
const TWO_FACTOR_SETUP_MS = 15 * 60 * 1000;
// Links to make an account: an administrator's, and one mailed.
const SIGN_UP_LINK_MS = 7 * 24 * 60 * 60 * 1000;
const SIGN_UP_MAIL_MS = 24 * 60 * 60 * 1000;
const MAX_SIGN_UP_LINKS = 500;
const SIGN_UP_TOKEN = /^[A-Za-z0-9_-]{32}$/;
const SIGN_UP_ID = /^[0-9a-f]{64}$/;
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
// A setting's id, or a field of the profile: "setting:editor-font-size".
const PREFERENCE_KEY = /^(setting|profile):[A-Za-z0-9_.-]{1,100}$/;

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

// A preference as a device last set it: any small JSON value, null for
// none.
const cleanPreference = (entry) => {
	if (!entry || typeof entry !== 'object') return null;
	if (typeof entry.key !== 'string' || !PREFERENCE_KEY.test(entry.key)) {
		return null;
	}
	const updatedAt = Number(entry.updatedAt);
	if (!Number.isFinite(updatedAt) || updatedAt < 0) return null;
	const value = entry.value === undefined ? null : entry.value;
	let json;
	try {
		json = JSON.stringify(value);
	} catch {
		return null;
	}
	if (json === undefined || json.length > MAX_PREFERENCE_CHARS) return null;
	// A device whose clock runs ahead does not win over later changes.
	return {
		key: entry.key,
		value: JSON.parse(json),
		updatedAt: Math.min(updatedAt, Date.now()),
	};
};

const mergeProjects = (stored, incoming) =>
	mergeLatest(stored, incoming, cleanProject, (entry) => entry.id);

const mergeWords = (stored, incoming) =>
	mergeLatest(stored, incoming, cleanWord, (entry) => entry.word);

const mergePreferences = (stored, incoming) =>
	mergeLatest(stored, incoming, cleanPreference, (entry) => entry.key);

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

const createAccounts = ({
	dir,
	log,
	mailer = null,
	appUrl = '',
	// Sign in with Google and ORCID (google.js, orcid.js): their tickets, or
	// null.
	google = null,
	orcid = null,
	// Who may create an account: "open" or "invitation"; and the domains
	// whose addresses may ask for a link to make one.
	signUp = 'open',
	signUpDomains = [],
}) => {
	fs.mkdirSync(dir, { recursive: true });
	const signUpMode = signUp === 'invitation' ? 'invitation' : 'open';
	const allowedDomains = signUpDomains
		.map((domain) => String(domain).trim().toLowerCase().replace(/^@/, ''))
		.filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain));
	// The links to make an account, by a hash of their token.
	const signUpsDir = path.join(dir, 'signups');
	fs.mkdirSync(signUpsDir, { recursive: true });
	// Which account confirmed each recovery address, by a hash of it.
	const emailsDir = path.join(dir, 'emails');
	fs.mkdirSync(emailsDir, { recursive: true });
	// The sites one signs in with, by the id an account keeps its link under
	// ({identity, linkedAt}); which account each of their accounts was linked
	// to, by a hash of its identifier, in a directory of that id.
	const providers = { google, orcid };
	const PROVIDER_NAMES = { google: 'Google', orcid: 'ORCID' };
	const PROVIDERS = Object.keys(providers);
	for (const id of PROVIDERS) fs.mkdirSync(path.join(dir, id), { recursive: true });
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

	const linkPath = (id, identity) => path.join(dir, id, `${identity}.json`);
	// The account a site's account is linked to: its key, if that account
	// still says so.
	const linkOwner = (id, identity) => {
		let key;
		try {
			key = JSON.parse(fs.readFileSync(linkPath(id, identity), 'utf8')).key;
		} catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
		if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return null;
		return read(key)?.[id]?.identity === identity ? key : null;
	};
	const setLinkOwner = (id, identity, key) => {
		const target = linkPath(id, identity);
		const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
		fs.writeFileSync(temp, JSON.stringify({ key }), { mode: 0o600 });
		fs.renameSync(temp, target);
	};
	const dropLinkOwner = (id, identity, key) => {
		if (!identity) return;
		try {
			const stored = JSON.parse(fs.readFileSync(linkPath(id, identity), 'utf8'));
			if (stored.key !== key) return;
		} catch {
			return;
		}
		fs.rmSync(linkPath(id, identity), { force: true });
	};
	// The site's account a ticket of its sign-in stands for.
	const ticketIdentity = (id, ticket) => {
		if (!providers[id]?.enabled) throw new HttpError(404, `${id}_disabled`);
		const identity = providers[id].identityFor(ticket);
		if (!identity) throw new HttpError(400, 'invalid_ticket');
		return identity;
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

	// Failures only: refused once there were `max` in the window.
	const refuseAfter = (bucket, max) => {
		const now = Date.now();
		const recent = (attempts.get(bucket) ?? []).filter(
			(time) => now - time < ATTEMPT_WINDOW_MS,
		);
		attempts.set(bucket, recent);
		if (recent.length >= max) throw new HttpError(429, 'too_many_attempts');
	};
	const noteFailure = (bucket) => {
		attempts.set(bucket, [...(attempts.get(bucket) ?? []), Date.now()]);
	};

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
	// As Overleaf's security emails: a change to how the account is signed in
	// to or recovered goes to its address (or `to`, the address it had), so
	// that one its owner did not make does not go unseen. Never in the way
	// of the change: an email that cannot go is only logged (mail.js).
	const tellOwner = (account, notice) => {
		if (!mailer || !notice) return;
		const to = notice.to ?? account.email?.address;
		if (!to) return;
		const language = listPreferences(account).find(
			(entry) => entry.key === 'setting:language',
		)?.value;
		mailer
			.send('security', {
				to,
				language: typeof language === 'string' ? language : undefined,
				username: account.username,
				change: notice.change,
				how: notice.how,
				provider: notice.provider,
				label: notice.label,
				link: `${appBase}/`,
			})
			.catch(() => {});
	};

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
			// Once the change is kept.
			if (result?.changed) tellOwner(account, result.notice);
			return result?.body;
		});
	};

	// Who owns each project, from the project links (shares.js): told with
	// every list, never stored with it.
	let describeProject = () => ({});
	const setProjectDescriber = (describe) => {
		describeProject = describe;
	};

	// Told each list a device sends (shares.js keeps who reaches a project
	// through a link); never in the way of the list.
	let projectsListed = () => {};
	const setProjectsListener = (listener) => {
		projectsListed = listener;
	};

	const listProjects = (account) =>
		Object.values(account.projects ?? {})
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((entry) =>
				entry.deleted
					? entry
					: { ...entry, ...describeProject(idOf(account), entry) },
			);

	// Two-factor authentication: the name authenticator apps show for this
	// server's accounts.
	const issuer = (() => {
		try {
			return `Feuillet (${new URL(appBase).host})`;
		} catch {
			return 'Feuillet';
		}
	})();
	const twoFactorOn = (account) => Boolean(account?.twoFactor?.secret);

	// The second factor of `account`, inside withAccount (whose caller
	// writes it): a one-time code, accepted once, or a recovery code, used
	// up. Nothing for an account without two-factor authentication.
	const checkSecondFactor = (account, code) => {
		if (!twoFactorOn(account)) return null;
		const given = typeof code === 'string' ? code.trim() : '';
		if (!given) throw new HttpError(401, 'code_required');
		const step = totp.verify(account.twoFactor.secret, given, {
			after: account.twoFactor.lastStep ?? -1,
		});
		if (step !== null) {
			account.twoFactor.lastStep = step;
			return 'code';
		}
		const codes = account.recovery?.codes ?? [];
		const hash = recoveryHash(given);
		if (!totp.isCode(given) && codes.includes(hash)) {
			account.recovery = {
				...account.recovery,
				codes: codes.filter((stored) => stored !== hash),
			};
			return 'recovery';
		}
		throw new HttpError(401, 'wrong_code');
	};

	// Whether a project's personal invitation is pending (shares.js).
	let inviteOpen = () => false;
	const setInviteChecker = (check) => {
		inviteOpen = check;
	};

	const signUpPath = (id) => path.join(signUpsDir, `${id}.json`);
	const readSignUp = (id) => {
		try {
			return JSON.parse(fs.readFileSync(signUpPath(id), 'utf8'));
		} catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
	};
	const signUpIds = () =>
		fs
			.readdirSync(signUpsDir)
			.filter((name) => name.endsWith('.json'))
			.map((name) => name.slice(0, -5))
			.filter((id) => SIGN_UP_ID.test(id));

	// The links to make an account still good, the others forgotten.
	const signUpLinks = () => {
		const now = Date.now();
		const links = [];
		for (const id of signUpIds()) {
			const link = readSignUp(id);
			if (!link || !(link.expiresAt > now)) {
				fs.rmSync(signUpPath(id), { force: true });
				continue;
			}
			links.push({ id, ...link });
		}
		return links.sort((a, b) => b.createdAt - a.createdAt);
	};

	// Links that ended go, with the address of a mailed one, each hour.
	setInterval(() => {
		try {
			signUpLinks();
		} catch (error) {
			log('sign-up links not pruned:', error.message);
		}
	}, 60 * 60 * 1000).unref();

	/** A new link to make an account: its token, shown once. */
	const makeSignUpLink = ({ by = null, email = null, ms = SIGN_UP_LINK_MS }) => {
		const links = signUpLinks();
		if (links.length >= MAX_SIGN_UP_LINKS) {
			throw new HttpError(429, 'too_many_links');
		}
		const token = crypto.randomBytes(24).toString('base64url');
		const now = Date.now();
		const link = {
			createdAt: now,
			expiresAt: now + ms,
			...(by ? { by } : {}),
			...(email ? { email } : {}),
		};
		const target = signUpPath(sha256(`signup:${token}`));
		fs.writeFileSync(target, JSON.stringify(link), { mode: 0o600 });
		return { token, expiresAt: link.expiresAt };
	};

	const revokeSignUpLink = (id) => {
		if (typeof id !== 'string' || !SIGN_UP_ID.test(id)) {
			throw new HttpError(400, 'invalid_link');
		}
		fs.rmSync(signUpPath(id), { force: true });
	};

	// The link of a token, used: gone, so that it makes one account.
	const useSignUpLink = (token) => {
		const id = sha256(`signup:${token}`);
		const link = readSignUp(id);
		fs.rmSync(signUpPath(id), { force: true });
		if (!link || !(link.expiresAt > Date.now())) {
			throw new HttpError(403, 'sign_up_link_expired');
		}
		return link;
	};

	// Whether this request may make an account, and by what.
	const admission = (body) => {
		if (signUpMode === 'open') return {};
		if (typeof body.signup === 'string' && SIGN_UP_TOKEN.test(body.signup)) {
			const link = readSignUp(sha256(`signup:${body.signup}`));
			if (!link || !(link.expiresAt > Date.now())) {
				throw new HttpError(403, 'sign_up_link_expired');
			}
			return {
				signUp: body.signup,
				by: link.email ? 'mailed link' : "an administrator's link",
			};
		}
		if (typeof body.invite === 'string' && inviteOpen(body.invite)) {
			return { by: 'invitation to a project' };
		}
		throw new HttpError(403, 'sign_up_closed');
	};

	const domainAllowed = (address) => {
		const domain = address.slice(address.lastIndexOf('@') + 1);
		return allowedDomains.some(
			(allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
		);
	};

	const signUpOptions = () => ({
		mode: signUpMode,
		domains: signUpMode === 'invitation' && mailer ? allowedDomains : [],
	});

	// A link to make an account, mailed to an address of the domains
	// allowed; the same answer whether or not it has an account.
	const mailSignUpLink = async (body, ip) => {
		if (signUpMode !== 'invitation' || !mailer || allowedDomains.length === 0) {
			throw new HttpError(404, 'sign_up_mail_disabled');
		}
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const address = normalizeEmail(body.email);
		if (!validEmail(address)) throw new HttpError(400, 'invalid_email');
		if (!domainAllowed(address)) throw new HttpError(403, 'domain_not_allowed');
		limit(`signup:${sha256(address)}`, MAX_MAILS_PER_ACCOUNT);
		const { token } = makeSignUpLink({ email: address, ms: SIGN_UP_MAIL_MS });
		try {
			await mailer.send('signup', {
				to: address,
				language: body.language,
				link: `${appBase}/#signup:${token}`,
			});
		} catch (error) {
			revokeSignUpLink(sha256(`signup:${token}`));
			throw new HttpError(502, error?.code === 'mail_quota' ? 'mail_quota' : 'mail_failed');
		}
		return { sent: true };
	};

	const register = async (body, ip, device) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const username = normalizeUsername(body.username);
		if (!validUsername(username)) throw new HttpError(400, 'invalid_username');
		if (!validPassword(body.password)) {
			throw new HttpError(400, 'invalid_password');
		}
		// Created linked to a Google or ORCID account, which no other may be.
		const linkedWith =
			PROVIDERS.find((id) => body[`${id}Ticket`] !== undefined) ?? null;
		const ticket = linkedWith ? body[`${linkedWith}Ticket`] : undefined;
		const identity = linkedWith ? ticketIdentity(linkedWith, ticket) : null;
		if (identity && linkOwner(linkedWith, identity)) {
			throw new HttpError(409, `${linkedWith}_taken`);
		}
		const key = keyOf(username);
		const admitted = admission(body);
		const passwordHash = await hashPassword(body.password);

		return withAccount(key, (existing) => {
			if (existing) throw new HttpError(409, 'username_taken');
			const now = Date.now();
			const account = {
				username,
				passwordHash,
				createdAt: now,
				projects: {},
				sessions: {},
				...(identity ? { [linkedWith]: { identity, linkedAt: now } } : {}),
			};
			if (identity) {
				if (
					linkOwner(linkedWith, identity) ||
					!providers[linkedWith].identityFor(ticket, { use: true })
				) {
					throw new HttpError(409, `${linkedWith}_taken`);
				}
				setLinkOwner(linkedWith, identity, key);
			}
			// Checked again, and used: a link to make an account makes one.
			const signUpLink = admitted.signUp ? useSignUpLink(admitted.signUp) : null;
			// A mailed link's address is confirmed: it becomes the account's.
			if (signUpLink?.email && !emailOwner(signUpLink.email)) {
				setEmailOwner(signUpLink.email, key);
				account.email = { address: signUpLink.email, confirmedAt: now };
			}
			const token = openSession(account, key, device);
			write(key, account);
			log(
				'account created',
				JSON.stringify(username),
				identity ? `with ${PROVIDER_NAMES[linkedWith]}` : '',
				admitted.by ? `(${admitted.by})` : '',
			);
			return { username, token };
		});
	};

	// Signs in with a site's account, to the account linked to it.
	const providerLogin = async (id, body, ip, device) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const identity = ticketIdentity(id, body.ticket);
		const key = linkOwner(id, identity);
		// The ticket stays good for creating an account linked to it.
		if (!key) throw new HttpError(404, `${id}_not_linked`);

		if (twoFactorOn(read(key))) limit(`failures:${key}`, MAX_FAILURES_PER_ACCOUNT);
		const result = await withAccount(key, (account) => {
			if (account?.[id]?.identity !== identity) {
				throw new HttpError(404, `${id}_not_linked`);
			}
			// Before the ticket is used up: it stays good for the code.
			const used = checkSecondFactor(account, body.code);
			if (!providers[id].identityFor(body.ticket, { use: true })) {
				throw new HttpError(400, 'invalid_ticket');
			}
			const token = openSession(account, key, device);
			write(key, account);
			if (used === 'recovery') log('signed in with a recovery code');
			return { username: account.username, token };
		});
		clearFailures(key);
		return result;
	};

	const linkStatus = (id, account) => ({
		enabled: Boolean(providers[id]?.enabled),
		linked: Boolean(account[id]),
		...(account[id] ? { linkedAt: account[id].linkedAt } : {}),
	});

	const getLink = (id, req) =>
		authenticate(req, (account) => ({ body: linkStatus(id, account) }));

	// Links the account to a site's account, or not any more.
	const setLink = (id, req, body) =>
		authenticate(req, async (account) => {
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			const key = keyOf(account.username);
			if (body.remove === true) {
				const linked = Boolean(account[id]);
				dropLinkOwner(id, account[id]?.identity, key);
				delete account[id];
				log(`${PROVIDER_NAMES[id]} account unlinked`);
				return {
					changed: true,
					body: linkStatus(id, account),
					...(linked
						? { notice: { change: 'unlinked', provider: PROVIDER_NAMES[id] } }
						: {}),
				};
			}
			const identity = ticketIdentity(id, body.ticket);
			const owner = linkOwner(id, identity);
			if (owner && owner !== key) throw new HttpError(409, `${id}_taken`);
			providers[id].identityFor(body.ticket, { use: true });
			let notice;
			if (account[id]?.identity !== identity) {
				dropLinkOwner(id, account[id]?.identity, key);
				account[id] = { identity, linkedAt: Date.now() };
				setLinkOwner(id, identity, key);
				log(`${PROVIDER_NAMES[id]} account linked`);
				notice = { change: 'linked', provider: PROVIDER_NAMES[id] };
			}
			return { changed: true, body: linkStatus(id, account), notice };
		});

	// Whether a password is the account's, as a device that signed in with
	// Google or ORCID asks before keeping a secret with it.
	const verifyPassword = (req, body) =>
		authenticate(req, async (account) => {
			const key = keyOf(account.username);
			limit(`failures:${key}`, MAX_FAILURES_PER_ACCOUNT);
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			clearFailures(key);
		});

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

		// Counted as attempts until the second factor too is right.
		const result = await withAccount(key, (current) => {
			if (!current) throw new HttpError(404, 'unknown_username');
			const used = checkSecondFactor(current, body.code);
			const token = openSession(current, key, device);
			write(key, current);
			if (used === 'recovery') log('signed in with a recovery code');
			return { username: current.username, token };
		});
		clearFailures(key);
		return result;
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
			return { changed: true, notice: { change: 'password' } };
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
			return {
				changed: true,
				body: { codes, createdAt },
				notice: { change: 'recovery-codes' },
			};
		});

	// The account's Git tokens that still work: made with its password.
	const gitTokensOf = (account) =>
		(account.gitTokens ?? []).filter(
			(entry) => entry.stamp === stampOf(account),
		);
	const listGitTokens = (account) =>
		gitTokensOf(account)
			.map(({ id, label, hint, createdAt, lastUsedAt }) => ({
				id,
				label,
				hint,
				createdAt,
				...(lastUsedAt ? { lastUsedAt } : {}),
			}))
			.sort((a, b) => b.createdAt - a.createdAt);

	const getGitTokens = (req) =>
		authenticate(req, (account) => ({
			body: { tokens: listGitTokens(account) },
		}));

	// A new Git token, shown only now; or one taken back.
	const changeGitTokens = (req, body) =>
		authenticate(req, async (account) => {
			if (typeof body.revoke === 'string') {
				const kept = gitTokensOf(account).filter(
					(entry) => entry.id !== body.revoke,
				);
				const changed = kept.length !== (account.gitTokens ?? []).length;
				account.gitTokens = kept;
				if (changed) log('git token revoked');
				return { changed, body: { tokens: listGitTokens(account) } };
			}
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			const label =
				typeof body.label === 'string'
					? body.label
							// biome-ignore lint/suspicious/noControlCharactersInRegex: removes them.
							.replace(/[\u0000-\u001f\u007f]/g, ' ')
							.trim()
							.slice(0, 60)
					: '';
			const kept = gitTokensOf(account);
			if (kept.length >= MAX_GIT_TOKENS) {
				throw new HttpError(409, 'too_many_tokens');
			}
			const token = `fgt_${crypto.randomBytes(32).toString('base64url')}`;
			account.gitTokens = [
				...kept,
				{
					id: crypto.randomBytes(8).toString('hex'),
					label,
					hint: token.slice(0, 8),
					hash: sha256(`git:${token}`),
					stamp: stampOf(account),
					createdAt: Date.now(),
				},
			];
			log('git token made');
			return {
				changed: true,
				body: { token, tokens: listGitTokens(account) },
				notice: { change: 'git-token', label },
			};
		});

	// Checks the account name and Git token that Git sends (git.js):
	// {id, username}; wrong ones, counted, are refused for a while.
	const verifyGitToken = async (username, token, ip) => {
		refuseAfter(`git-ip:${ip}`, MAX_GIT_FAILURES_PER_IP);
		const name = normalizeUsername(username);
		const key = validUsername(name) ? keyOf(name) : null;
		if (key) refuseAfter(`git-failures:${key}`, MAX_GIT_FAILURES_PER_ACCOUNT);
		// not_a_token: what Git gave is no Git token at all, most likely the
		// account's password, which Git asks for as "Password".
		const fail = (code = 'wrong_token') => {
			noteFailure(`git-ip:${ip}`);
			if (key) noteFailure(`git-failures:${key}`);
			return new HttpError(401, code);
		};
		if (typeof token !== 'string' || !GIT_TOKEN.test(token)) {
			throw fail('not_a_token');
		}
		if (!key) throw fail();
		const hash = sha256(`git:${token}`);
		const found = await withAccount(key, (account) => {
			if (!account) return null;
			const entry = gitTokensOf(account).find((candidate) =>
				sameHash(candidate.hash, hash),
			);
			if (!entry) return null;
			const now = Date.now();
			if (now - (entry.lastUsedAt ?? 0) >= GIT_TOUCH_MS) {
				entry.lastUsedAt = now;
				account.lastUsedAt = Math.max(account.lastUsedAt ?? 0, now);
				write(key, account);
			}
			return { id: idOf(account), username: account.username };
		});
		if (!found) throw fail();
		return found;
	};

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
			tellOwner(account, { change: 'password', how: 'recovery-code' });
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
				const removed = account.email?.address;
				dropEmailOwner(removed, key);
				delete account.email;
				delete account.emailToken;
				log('recovery address removed');
				return {
					changed: true,
					body: emailStatus(account),
					...(removed
						? { notice: { change: 'email-removed', to: removed } }
						: {}),
				};
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
			const former = account.email?.address;
			if (former !== pending.address) {
				dropEmailOwner(former, parsed.key);
			}
			setEmailOwner(pending.address, parsed.key);
			account.email = { address: pending.address, confirmedAt: Date.now() };
			delete account.emailToken;
			write(parsed.key, account);
			log('recovery address confirmed');
			if (former && former !== pending.address) {
				tellOwner(account, { change: 'email-changed', to: former });
			}
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
			tellOwner(account, { change: 'password', how: 'email-link' });
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
		for (const id of PROVIDERS) {
			dropLinkOwner(id, account[id]?.identity, keyOf(account.username));
		}
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
				twoFactor: twoFactorOn(account),
				listed: Object.values(account.projects ?? {}).filter(
					(entry) => !entry.deleted,
				).length,
			});
		}
		return list;
	};

	// The entries of every account's list, by the links they keep only
	// (shares.js reads them), for the administration page to tell the
	// projects no list names.
	const listedEntries = () => {
		const entries = [];
		for (const file of fs.readdirSync(dir)) {
			if (!/^[0-9a-f]{64}\.json$/.test(file)) continue;
			let account;
			try {
				account = read(file.slice(0, -5));
			} catch {
				continue;
			}
			for (const entry of Object.values(account?.projects ?? {})) {
				if (entry.deleted) continue;
				entries.push({
					id: entry.id,
					editId: entry.editId,
					docUrl: entry.docUrl,
				});
			}
		}
		return entries;
	};

	// An id for an account that a new account with the same name will not
	// have.
	const idOf = (account) => `${keyOf(account.username)}.${account.createdAt}`;

	// Changes with the password, so that what was granted with the old one
	// ends with it, as other devices are signed out.
	const stampOf = (account) => sha256(String(account.passwordHash)).slice(0, 16);

	// Checks a username and password as signing in does, and the second
	// factor, without opening a session: for letting an application use the
	// account (oauth.js). `code_required` says the password was right.
	const verifyCredentials = async (username, password, ip, code) => {
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
		const verified = await secondFactorOf(key, code);
		clearFailures(key);
		return verified;
	};

	// The second factor alone, for an account whose password was checked a
	// moment ago by verifyCredentials (oauth.js keeps that, for a request).
	const verifySecondFactor = async (username, code, ip) => {
		limit(`ip:${ip}`, MAX_ATTEMPTS_PER_IP);
		const name = normalizeUsername(username);
		const key = keyOf(name);
		if (!validUsername(name) || !twoFactorOn(read(key))) {
			throw new HttpError(400, 'invalid_credentials');
		}
		limit(`failures:${key}`, MAX_FAILURES_PER_ACCOUNT);
		const verified = await secondFactorOf(key, code);
		clearFailures(key);
		return verified;
	};

	const secondFactorOf = (key, code) =>
		withAccount(key, (account) => {
			if (!account) throw new HttpError(404, 'unknown_username');
			if (checkSecondFactor(account, code)) write(key, account);
			return {
				id: idOf(account),
				username: account.username,
				stamp: stampOf(account),
			};
		});

	// Two-factor authentication, from the profile.
	const twoFactorStatus = (account) => ({
		enabled: twoFactorOn(account),
		...(account.twoFactor?.enabledAt ? { enabledAt: account.twoFactor.enabledAt } : {}),
		recoveryCodes: account.recovery?.codes?.length ?? 0,
	});

	const getTwoFactor = (req) =>
		authenticate(req, (account) => ({ body: twoFactorStatus(account) }));

	const setTwoFactor = (req, body) =>
		authenticate(req, async (account) => {
			const key = keyOf(account.username);
			// Off: the password and a code, or a recovery code.
			if (body.remove === true) {
				if (!twoFactorOn(account)) return { body: twoFactorStatus(account) };
				limit(`failures:${key}`, MAX_FAILURES_PER_ACCOUNT);
				if (!(await checkPassword(String(body.password), account.passwordHash))) {
					throw new HttpError(401, 'wrong_password');
				}
				checkSecondFactor(account, body.code);
				clearFailures(key);
				delete account.twoFactor;
				delete account.twoFactorPending;
				log('two-factor authentication turned off');
				return {
					changed: true,
					body: twoFactorStatus(account),
					notice: { change: 'two-factor-off' },
				};
			}
			if (twoFactorOn(account)) throw new HttpError(409, 'already_on');
			// Confirmed by a code of the new secret's.
			if (body.code !== undefined) {
				const pending = account.twoFactorPending;
				if (!pending || pending.createdAt + TWO_FACTOR_SETUP_MS <= Date.now()) {
					throw new HttpError(410, 'setup_expired');
				}
				limit(`failures:${key}`, MAX_FAILURES_PER_ACCOUNT);
				const step = totp.verify(pending.secret, String(body.code));
				if (step === null) throw new HttpError(401, 'wrong_code');
				clearFailures(key);
				const enabledAt = Date.now();
				account.twoFactor = { secret: pending.secret, enabledAt, lastStep: step };
				delete account.twoFactorPending;
				// Without recovery codes, a lost phone would lose the account.
				let codes;
				if (!(account.recovery?.codes?.length > 0)) {
					codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
					account.recovery = { createdAt: enabledAt, codes: codes.map(recoveryHash) };
				}
				log('two-factor authentication turned on');
				return {
					changed: true,
					body: {
						...twoFactorStatus(account),
						...(codes ? { codes, codesCreatedAt: enabledAt } : {}),
					},
					notice: { change: 'two-factor-on' },
				};
			}
			// Begun with the password: a new secret, for the app.
			if (!(await checkPassword(String(body.password), account.passwordHash))) {
				throw new HttpError(401, 'wrong_password');
			}
			const secret = totp.newSecret();
			account.twoFactorPending = { secret, createdAt: Date.now() };
			return {
				changed: true,
				body: {
					secret,
					uri: totp.otpauthUri({ secret, account: account.username, issuer }),
				},
			};
		});

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

	// Where and how to tell an account about the review (reviewNotices.js):
	// its confirmed address, its interface language, and whether it wants
	// these emails (on unless turned off in its preferences).
	const reviewContactOf = (id) => {
		const [key, createdAt] = String(id).split('.');
		if (!/^[0-9a-f]{64}$/.test(key ?? '')) return null;
		const account = read(key);
		if (!account || String(account.createdAt) !== createdAt) return null;
		// Settings that follow the account (src/utils/accountPreferences.ts).
		const preference = (name) =>
			listPreferences(account).find((entry) => entry.key === `setting:${name}`)
				?.value;
		const language = preference('language');
		return {
			email: account.email?.confirmedAt ? account.email.address : null,
			language: typeof language === 'string' ? language : undefined,
			enabled: preference('review-email-notifications') !== false,
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
			const before = account.projects ?? {};
			const merged = mergeProjects(before, body.projects);
			if (Object.keys(merged).length > MAX_PROJECTS) {
				throw new HttpError(413, 'too_many_projects');
			}
			account.projects = merged;
			try {
				projectsListed(idOf(account), Object.values(merged), before);
			} catch (error) {
				log('project list not noted', error?.message ?? error);
			}
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

	const listPreferences = (account) => Object.values(account.preferences ?? {});

	const getPreferences = (req) =>
		authenticate(req, (account) => ({
			body: { entries: listPreferences(account) },
		}));

	const syncPreferences = (req, body) =>
		authenticate(req, (account) => {
			if (!Array.isArray(body.entries)) {
				throw new HttpError(400, 'invalid_preferences');
			}
			const merged = mergePreferences(account.preferences ?? {}, body.entries);
			if (Object.keys(merged).length > MAX_PREFERENCES) {
				throw new HttpError(413, 'too_many_preferences');
			}
			const changed =
				JSON.stringify(merged) !== JSON.stringify(account.preferences ?? {});
			account.preferences = merged;
			return { changed, body: { entries: listPreferences(account) } };
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
		'GET /account/two-factor': (req) => getTwoFactor(req),
		'POST /account/two-factor': (req, body) => setTwoFactor(req, body),
		'GET /account/sign-up': () => signUpOptions(),
		'POST /account/sign-up': (req, body) =>
			mailSignUpLink(body, clientAddress(req)),
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
		'GET /account/preferences': (req) => getPreferences(req),
		'POST /account/preferences': (req, body) => syncPreferences(req, body),
		'GET /account/git-tokens': (req) => getGitTokens(req),
		'POST /account/git-tokens': (req, body) => changeGitTokens(req, body),
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
		'POST /account/password/verify': (req, body) => verifyPassword(req, body),
		...Object.fromEntries(
			PROVIDERS.flatMap((id) => [
				[`GET /account/${id}`, (req) => getLink(id, req)],
				[`POST /account/${id}`, (req, body) => setLink(id, req, body)],
				[
					`POST /account/${id}/login`,
					(req, body) => providerLogin(id, body, clientAddress(req), deviceOf(req)),
				],
			]),
		),
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
		verifySecondFactor,
		accountById,
		clientAddress,
		findAccount,
		usernameOf,
		hasConfirmedEmail,
		reviewContactOf,
		summaries,
		listedEntries,
		verifyGitToken,
		clientAddress,
		removeAccount,
		shareProject,
		unshareProject,
		setProjectDescriber,
		setProjectsListener,
		setAccountDeleted,
		setInviteChecker,
		signUpOptions,
		signUpLinks,
		makeSignUpLink,
		revokeSignUpLink,
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
