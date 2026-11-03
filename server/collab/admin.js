// server/collab/admin.js
// The administration page, as Overleaf Server's: for the accounts named in
// ADMIN_ACCOUNTS, the server's state (its disk, its emails, its backups) and
// every account, which they may delete with the projects it owns.
//
//   GET  /admin          (token) -> {admin}: whether the account is one
//   GET  /admin/overview (token, admin) -> {you, server, mail, backup,
//                        accounts}
//   POST /admin/delete {account, username} (token, admin) -> {deleted:
//                        true}: the account with this id, if it still has
//                        this name; neither one's own nor another
//                        administrator's
//
// Of each account it shows the name, when it was made and last used, its
// signed-in devices, how many projects it owns and is a member of, the space
// the projects it owns take, and whether its email address is confirmed;
// never the address, the password, nor the projects' names or contents.
//
// The backups' state comes from the files deploy/backup.sh writes in
// BACKUP_STATUS_DIR: backup.json, the last backup made, and
// backup-failed.json, the last that failed since.

const fs = require('node:fs');
const path = require('node:path');

const MAX_BODY_BYTES = 4096;
const ACCOUNT_ID = /^[0-9a-f]{64}\.[0-9]{1,16}$/;

class HttpError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

// The bytes in a folder and those below it; 0 when there is none.
const sizeOf = async (folder) => {
	let entries;
	try {
		entries = await fs.promises.readdir(folder, { withFileTypes: true });
	} catch {
		return 0;
	}
	let total = 0;
	for (const entry of entries) {
		const full = path.join(folder, entry.name);
		if (entry.isDirectory()) {
			total += await sizeOf(full);
		} else if (entry.isFile()) {
			try {
				total += (await fs.promises.stat(full)).size;
			} catch {}
		}
	}
	return total;
};

// The bytes of each folder in `folder`, by name.
const sizesIn = async (folder) => {
	const sizes = new Map();
	let entries;
	try {
		entries = await fs.promises.readdir(folder, { withFileTypes: true });
	} catch {
		return sizes;
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			sizes.set(entry.name, await sizeOf(path.join(folder, entry.name)));
		}
	}
	return sizes;
};

const sum = (sizes) => [...sizes.values()].reduce((a, b) => a + b, 0);

const readStatus = (file) => {
	try {
		const value = JSON.parse(fs.readFileSync(file, 'utf8'));
		return value && typeof value === 'object' && !Array.isArray(value)
			? value
			: null;
	} catch {
		return null;
	}
};

const timeOf = (value) => {
	const time = Date.parse(String(value ?? ''));
	return Number.isFinite(time) ? time : null;
};

// What deploy/backup.sh last wrote: the last backup, and a failure after it.
const backupState = (dir) => {
	if (!dir) return null;
	const made = readStatus(path.join(dir, 'backup.json'));
	const failed = readStatus(path.join(dir, 'backup-failed.json'));
	const madeAt = timeOf(made?.time);
	const failedAt = timeOf(failed?.time);
	if (madeAt === null && failedAt === null) return null;
	return {
		...(madeAt !== null
			? {
					last: {
						time: madeAt,
						bytes: (Number(made.kb) || 0) * 1024,
						kept: Number(made.kept) || 0,
						copy: ['done', 'failed'].includes(made.copy) ? made.copy : 'none',
					},
				}
			: {}),
		...(failedAt !== null && (madeAt === null || failedAt > madeAt)
			? {
					failed: {
						time: failedAt,
						error: String(failed.error ?? '').slice(0, 500),
					},
				}
			: {}),
	};
};

const createAdmin = ({
	admins = [],
	accounts,
	shares,
	mailer = null,
	dirs = {},
	backupStatusDir = '',
	activity = () => ({ documents: 0, connections: 0 }),
	startedAt = Date.now(),
	log,
}) => {
	const names = new Set(
		admins.map((name) => String(name).trim().toLowerCase()).filter(Boolean),
	);
	const isAdminName = (username) =>
		typeof username === 'string' && names.has(username.toLowerCase());

	// Who sent a request, and whether they administer the server.
	const who = async (req) => {
		const id = await accounts.identify(req);
		const username = accounts.usernameOf(id);
		return { id, username, admin: isAdminName(username) };
	};
	const requireAdmin = async (req) => {
		const caller = await who(req);
		if (!caller.admin) throw new HttpError(403, 'not_admin');
		return caller;
	};

	const free = async () => {
		try {
			const stats = await fs.promises.statfs(dirs.files);
			return stats.bavail * stats.bsize;
		} catch {
			return null;
		}
	};

	const overview = async (req) => {
		const caller = await requireAdmin(req);
		const [files, versions, documents, accountBytes, freeBytes] =
			await Promise.all([
				sizesIn(dirs.files),
				sizesIn(dirs.history),
				dirs.documents ? sizeOf(dirs.documents) : Promise.resolve(0),
				sizeOf(dirs.accounts),
				free(),
			]);
		const projects = shares.census();
		const owned = new Map();
		const memberOf = new Map();
		for (const { project, owner, members } of projects) {
			if (owner) owned.set(owner, [...(owned.get(owner) ?? []), project]);
			for (const member of members) {
				memberOf.set(member, (memberOf.get(member) ?? 0) + 1);
			}
		}
		const bytesOf = (project) =>
			(files.get(project) ?? 0) + (versions.get(project) ?? 0);
		return {
			you: caller.id,
			server: {
				startedAt,
				...activity(),
				projects: projects.length,
				unowned: projects.filter((entry) => !entry.owner).length,
				disk: {
					documents,
					files: sum(files),
					versions: sum(versions),
					accounts: accountBytes,
					...(freeBytes !== null ? { free: freeBytes } : {}),
				},
			},
			mail: mailer ? mailer.stats() : null,
			backup: backupState(backupStatusDir),
			accounts: accounts.summaries().map((account) => {
				const theirs = owned.get(account.id) ?? [];
				return {
					...account,
					owned: theirs.length,
					memberOf: memberOf.get(account.id) ?? 0,
					bytes: theirs.reduce((total, id) => total + bytesOf(id), 0),
					admin: isAdminName(account.username),
				};
			}),
		};
	};

	const remove = async (req, body) => {
		const caller = await requireAdmin(req);
		const id = typeof body.account === 'string' ? body.account : '';
		if (!ACCOUNT_ID.test(id)) throw new HttpError(400, 'invalid_account');
		const username = accounts.usernameOf(id);
		if (!username) throw new HttpError(404, 'unknown_account');
		// One's own account goes from the profile; another administrator's,
		// once out of ADMIN_ACCOUNTS.
		if (id === caller.id || isAdminName(username)) {
			throw new HttpError(403, 'admin_account');
		}
		await accounts.removeAccount(id, String(body.username ?? ''));
		log(
			'account deleted by an administrator',
			JSON.stringify(username),
			'by',
			JSON.stringify(caller.username),
		);
		return { deleted: true };
	};

	const readBody = (req) =>
		new Promise((done, fail) => {
			let size = 0;
			const chunks = [];
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					fail(new HttpError(413, 'too_large'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
					done(body && typeof body === 'object' ? body : {});
				} catch {
					fail(new HttpError(400, 'invalid_json'));
				}
			});
			req.on('error', () => fail(new HttpError(400, 'interrupted')));
		});

	const routes = {
		'GET /admin': async (req) => ({ admin: (await who(req)).admin }),
		'GET /admin/overview': (req) => overview(req),
		'POST /admin/delete': async (req) => remove(req, await readBody(req)),
	};

	const handles = (url) => url === '/admin' || url.startsWith('/admin/');

	const handle = async (req, res, url) => {
		const reply = (status, body) => {
			res.writeHead(status, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			});
			res.end(JSON.stringify(body));
		};
		const route = routes[`${req.method} ${url}`];
		if (!route) {
			req.resume();
			reply(404, { error: 'not_found' });
			return;
		}
		try {
			if (req.method === 'GET') req.resume();
			reply(200, await route(req));
		} catch (error) {
			// Errors from the accounts (signed out...) carry a status too.
			if (Number.isInteger(error?.status) && typeof error.code === 'string') {
				reply(error.status, { error: error.code });
				return;
			}
			log('administration request failed', error);
			reply(500, { error: 'server_error' });
		}
	};

	return { handles, handle, enabled: names.size > 0 };
};

module.exports = { createAdmin, backupState };
