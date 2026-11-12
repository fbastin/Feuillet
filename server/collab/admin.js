// server/collab/admin.js
// The administration page, as Overleaf Server's: for the accounts named in
// ADMIN_ACCOUNTS, the server's state (its disk, its emails, its backups) and
// every account, which they may delete with the projects it owns.
//
//   GET  /admin          (token) -> {admin}: whether the account is one
//   GET  /admin/overview (token, admin) -> {you, server, mail, backup,
//                        compile, grammar, accounts}: compile, the TeX Live
//                        servers' load and what they did since they
//                        started (server/texlive/server.js, GET /status),
//                        {ok: false} when they do not answer; grammar,
//                        whether LanguageTool answers
//   POST /admin/delete {account, username} (token, admin) -> {deleted:
//                        true}: the account with this id, if it still has
//                        this name; neither one's own nor another
//                        administrator's
//   POST /admin/delete-projects {projects: [key]} (token, admin) ->
//                        {deleted, skipped}: the orphan projects with these
//                        keys, deleted for good; those no longer orphans
//                        are skipped
//   GET  /admin/sign-up-links (token, admin) -> {mode, domains, links}: who
//                        may create an account (SIGN_UP, accounts.js) and
//                        the links to make one still good, without their
//                        tokens: {id, createdAt, expiresAt, by, mailed}
//   POST /admin/sign-up-links {} (token, admin) -> {token, expiresAt,
//                        links}: a new link, shown once
//   POST /admin/sign-up-links {revoke: id} (token, admin) -> {links}
//
// Of each account it shows the name, when it was made and last used, its
// signed-in devices, how many projects it owns and is a member of, the space
// the projects it owns take, and whether its email address is confirmed;
// never the address, the password, nor the projects' names or contents.
//
// Orphan projects are those no one can find any more: no account owns
// them and none lists them ("none"), the account that owned them was
// deleted ("gone"), their owner's list no longer names them ("unlisted"),
// or they were deleted but their contents remain ("deleted"). Of each it
// shows why, its members, its space, when it last changed and whether it is
// open now, under a key made from its id, which is never shown: knowing an
// id may let one edit the project.
//
// The backups' state comes from the files deploy/backup.sh writes in
// BACKUP_STATUS_DIR: backup.json, the last backup made, and
// backup-failed.json, the last that failed since.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Room for a thousand project keys.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROJECTS = 1000;
const ACCOUNT_ID = /^[0-9a-f]{64}\.[0-9]{1,16}$/;
const PROJECT_KEY = /^[0-9a-f]{24}$/;
// As shares.js: project ids, but not its read-only and review links.
const PROJECT_ID =
	/^(?!view[0-9a-f]{32}$)(?!review[0-9a-f]{32}$)[A-Za-z0-9_-]{1,100}$/;

// What stands for a project on the page, in place of its id.
const keyOf = (project) =>
	crypto
		.createHash('sha256')
		.update(`project:${project}`)
		.digest('hex')
		.slice(0, 24);

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

// When a file or folder last changed; 0 when there is none.
const mtimeOf = async (file) => {
	try {
		return (await fs.promises.stat(file)).mtimeMs;
	} catch {
		return 0;
	}
};

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
	openProjects = () => new Set(),
	storedProjects = async () => new Set(),
	startedAt = Date.now(),
	// The TeX Live servers' load and LanguageTool's state, or null.
	compileStatus = null,
	grammarStatus = null,
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

	// When a project last changed: its last version, or the last file it
	// was given.
	const changedAt = async (project) =>
		Math.max(
			await mtimeOf(path.join(dirs.history ?? '', project, 'index.json')),
			await mtimeOf(path.join(dirs.files ?? '', project)),
		);

	// The projects no one can find any more (see above), with their ids.
	const orphansOf = async ({ records, files, versions }) => {
		const stored = await storedProjects();
		const open = openProjects();
		const listed = new Set();
		for (const entry of accounts.listedEntries()) {
			for (const project of shares.projectsNamedBy(entry)) {
				listed.add(project);
			}
		}
		const recordOf = new Map(records.map((record) => [record.project, record]));
		const ids = new Set([
			...recordOf.keys(),
			...files.keys(),
			...versions.keys(),
			...stored,
		]);
		const orphans = [];
		for (const project of ids) {
			if (!PROJECT_ID.test(project)) continue;
			const record = recordOf.get(project);
			const stays =
				files.has(project) || versions.has(project) || stored.has(project);
			const reason = record?.deleted
				? stays
					? 'deleted'
					: null
				: record?.owner && !accounts.usernameOf(record.owner)
					? 'gone'
					: listed.has(project)
						? null
						: record?.owner
							? 'unlisted'
							: 'none';
			if (!reason) continue;
			const time = await changedAt(project);
			orphans.push({
				project,
				key: keyOf(project),
				reason,
				members: record && !record.deleted ? record.members.length : 0,
				bytes: (files.get(project) ?? 0) + (versions.get(project) ?? 0),
				...(time > 0 ? { changedAt: Math.round(time) } : {}),
				open: open.has(project),
			});
		}
		return orphans;
	};

	const overview = async (req) => {
		const caller = await requireAdmin(req);
		const [compile, grammar] = await Promise.all([
			compileStatus ? compileStatus() : null,
			grammarStatus ? grammarStatus() : null,
		]);
		const [files, versions, documents, accountBytes, gitBytes, freeBytes] =
			await Promise.all([
				sizesIn(dirs.files),
				sizesIn(dirs.history),
				dirs.documents ? sizeOf(dirs.documents) : Promise.resolve(0),
				sizeOf(dirs.accounts),
				dirs.git ? sizeOf(dirs.git) : Promise.resolve(0),
				free(),
			]);
		const records = shares.census();
		const projects = records.filter((record) => !record.deleted);
		const orphans = await orphansOf({ records, files, versions });
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
					git: gitBytes,
					...(freeBytes !== null ? { free: freeBytes } : {}),
				},
			},
			mail: mailer ? mailer.stats() : null,
			backup: backupState(backupStatusDir),
			compile,
			grammar,
			// Never their ids.
			orphans: orphans.map(({ project, ...orphan }) => orphan),
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

	const removeProjects = async (req, body) => {
		const caller = await requireAdmin(req);
		const keys = Array.isArray(body.projects) ? body.projects : null;
		if (
			!keys ||
			keys.length === 0 ||
			keys.length > MAX_PROJECTS ||
			!keys.every((key) => typeof key === 'string' && PROJECT_KEY.test(key))
		) {
			throw new HttpError(400, 'invalid_projects');
		}
		const wanted = new Set(keys);
		// Orphans as they are now: one claimed or listed since stays.
		const [files, versions] = await Promise.all([
			sizesIn(dirs.files),
			sizesIn(dirs.history),
		]);
		const orphans = await orphansOf({
			records: shares.census(),
			files,
			versions,
		});
		let deleted = 0;
		for (const { project, key } of orphans) {
			if (!wanted.has(key)) continue;
			await shares.purge(project);
			deleted++;
		}
		log(
			'orphan projects deleted by an administrator:',
			deleted,
			'by',
			JSON.stringify(caller.username),
		);
		return { deleted, skipped: wanted.size - deleted };
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

	// The links to make an account, as the page shows them: who made each,
	// and whether it was mailed (to an address it never shows).
	const listSignUpLinks = () =>
		accounts.signUpLinks().map((link) => ({
			id: link.id,
			createdAt: link.createdAt,
			expiresAt: link.expiresAt,
			by: link.by ? (accounts.usernameOf(link.by) ?? '') : '',
			mailed: Boolean(link.email),
		}));

	const signUpLinks = async (req) => {
		await requireAdmin(req);
		return { ...accounts.signUpOptions(), links: listSignUpLinks() };
	};

	const changeSignUpLinks = async (req, body) => {
		const caller = await requireAdmin(req);
		if (body.revoke !== undefined) {
			accounts.revokeSignUpLink(body.revoke);
			return { links: listSignUpLinks() };
		}
		const made = accounts.makeSignUpLink({ by: caller.id });
		log('sign-up link made by', JSON.stringify(caller.username));
		return { ...made, links: listSignUpLinks() };
	};

	const routes = {
		'GET /admin': async (req) => ({ admin: (await who(req)).admin }),
		'GET /admin/sign-up-links': (req) => signUpLinks(req),
		'POST /admin/sign-up-links': async (req) =>
			changeSignUpLinks(req, await readBody(req)),
		'GET /admin/overview': (req) => overview(req),
		'POST /admin/delete': async (req) => remove(req, await readBody(req)),
		'POST /admin/delete-projects': async (req) =>
			removeProjects(req, await readBody(req)),
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

module.exports = { createAdmin, backupState, keyOf };
