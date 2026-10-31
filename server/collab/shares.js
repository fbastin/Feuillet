// server/collab/shares.js
// Links to projects and their collaborators, as on Overleaf.
//
// Editing: a project opens under the id it was created with, until its owner
// replaces its editing link; from then on it opens under the new id only, and
// whoever kept an older one is cut off. Its documents and files stay stored
// under the id it was created with.
//
// Read-only: a view id opens the project too, but the server drops whatever
// is sent through it to change the project.
//
// Review: a review id, given to reviewers only, opens the project for
// comments and tracked changes; the server lets through it only changes to
// documents that leave their text, tracked changes rejected, as it was
// (review.js), and to the project's chat.
//
// Collaborators: the owner, a Feuillet account, may invite other accounts by
// name, as editors, reviewers or readers. The project appears in their list,
// and they may name it by a link that no longer opens it to learn the
// current one, so they follow when it changes. Removing an editor replaces
// the editing link, a reviewer the review link, and a reader the read-only
// link, which cuts them off.
//
//   POST /share/view {project}               -> {view}, the same each time
//   POST /share/view {project, reset: true}  -> {view}, a new one; the old
//                                               one stops working
//   POST /share/edit {project}       (token) -> {owner, role, edit, view}
//   POST /share/edit {project, claim: true}     the account becomes the owner
//                                               if the project has none
//   POST /share/edit {project, reset: true}     (owner) a new editing id; the
//                                               old one stops working
//   POST /share/members {project}    (token) -> {members, owner}, for any
//                                    member, as Overleaf shows collaborators
//   POST /share/members {project, add: {username, role}, name, type}
//   POST /share/members {project, remove: username}
//   POST /share/copy {project, name} (token) -> {project}, a copy of the
//                                               project the account owns
//   POST /share/invites {project}    (token) -> {invites}, for the owner
//   POST /share/invites {project, create: {role}, name, type} -> {invite,
//                                    invites}: a personal invitation link
//   POST /share/invites {project, revoke: invite} -> {invites}
//   POST /share/accept {invite}      (token) -> {project, role, name, type}:
//                                    the account becomes a member
//
// `project` is an editing id, or for /share/edit any link the account holds.
// Knowing an editing id is what lets someone edit the project, so it also
// lets them create or replace its read-only link. `owner` is "you", "other"
// or "none"; `role` is "owner", "editor", "reviewer", "reader" or null;
// `edit`, the current editing id, goes to the owner and editors, `review`,
// the current review link, to reviewers who ask with one, and `view`, the
// current read-only link, to readers who ask with one.
//
// Copies, as Overleaf's "Make a copy": any link that opens a project lets an
// account copy it (copy.js); the copy is a new project the account owns.
// Account lists tell who owns each project (`describe`).
//
// Invitations, as Overleaf's by email but without one: the owner makes a
// link for a role and sends it; whoever opens it signed in, with an account
// made then if need be, becomes a member with that role. A link works once,
// for 30 days, and its owner may take it back before.
//
// SHARES_DIR keeps one file per project (projects/<project>.json: {view,
// review, edit, owner, members, invites}), one per read-only link
// (views/<view>.json: {project, replaced}), one per review link
// (reviews/<review>.json: the same), one per editing id given out
// (edits/<edit>.json: the same) and one per pending invitation
// (invites/<invite>.json: {project, role, name, type, createdAt,
// expiresAt}).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BODY_BYTES = 4096;
const MAX_MEMBERS = 200;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,100}$/;
// Project ids are UUIDs, which never start with "view" or "review".
const VIEW_ID = /^view[0-9a-f]{32}$/;
const REVIEW_ID = /^review[0-9a-f]{32}$/;
const ROLES = ['editor', 'reviewer', 'reader'];
const INVITE_ID = /^[0-9a-f]{48}$/;
const INVITE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_INVITES = 50;
const PROJECT_TYPES = ['latex', 'typst'];

class HttpError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

const isViewId = (id) => VIEW_ID.test(id);
const isReviewId = (id) => REVIEW_ID.test(id);
const isProjectId = (id) =>
	typeof id === 'string' &&
	PROJECT_ID.test(id) &&
	!isViewId(id) &&
	!isReviewId(id);

const createShares = ({
	dir,
	log,
	accounts,
	onRevoke = () => {},
	copyProject = null,
}) => {
	const projectsDir = path.join(dir, 'projects');
	const viewsDir = path.join(dir, 'views');
	const reviewsDir = path.join(dir, 'reviews');
	const editsDir = path.join(dir, 'edits');
	const invitesDir = path.join(dir, 'invites');
	for (const folder of [
		projectsDir,
		viewsDir,
		reviewsDir,
		editsDir,
		invitesDir,
	]) {
		fs.mkdirSync(folder, { recursive: true });
	}

	const readJson = (file) => {
		try {
			return JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
	};

	const writeJson = (file, value) => {
		const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
		fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
		fs.renameSync(temp, file);
	};

	const projectPath = (project) => path.join(projectsDir, `${project}.json`);
	const viewPath = (view) => path.join(viewsDir, `${view}.json`);
	const reviewPath = (review) => path.join(reviewsDir, `${review}.json`);
	const editPath = (edit) => path.join(editsDir, `${edit}.json`);
	const invitePath = (invite) => path.join(invitesDir, `${invite}.json`);

	const readProject = (project) => readJson(projectPath(project)) ?? {};
	const writeProject = (project, record) =>
		writeJson(projectPath(project), record);

	// What an id opens: {project, kind, access}, where `project` is the id
	// the project's documents and files are stored under, `kind` is "edit",
	// "review" or "view", and `access` is "edit", "review", "view" or
	// "replaced" (the id opened the project until its link was replaced);
	// null when it opens nothing.
	const lookup = (id) => {
		if (typeof id !== 'string' || !PROJECT_ID.test(id)) return null;
		const kind = isViewId(id) ? 'view' : isReviewId(id) ? 'review' : null;
		if (kind) {
			const given = readJson(kind === 'view' ? viewPath(id) : reviewPath(id));
			return isProjectId(given?.project)
				? {
						project: given.project,
						kind,
						access: given.replaced ? 'replaced' : kind,
					}
				: null;
		}
		const given = readJson(editPath(id));
		if (given) {
			return isProjectId(given.project)
				? {
						project: given.project,
						kind: 'edit',
						access: given.replaced ? 'replaced' : 'edit',
					}
				: null;
		}
		return {
			project: id,
			kind: 'edit',
			access: readJson(projectPath(id))?.edit ? 'replaced' : 'edit',
		};
	};

	const roleOf = (record, account) =>
		record.owner === account
			? 'owner'
			: (record.members?.[account]?.role ?? null);

	// The read-only or review link, made on first use; `reset` replaces it
	// and cuts off whoever opened the old one.
	const sideLinkOf = (kind, project, reset) => {
		const isId = kind === 'view' ? isViewId : isReviewId;
		const pathOf = kind === 'view' ? viewPath : reviewPath;
		const name = kind === 'view' ? 'read-only' : 'review';
		const record = readProject(project);
		const current = record[kind];
		if (isId(current) && !reset) return current;

		const link = `${kind}${crypto.randomBytes(16).toString('hex')}`;
		writeJson(pathOf(link), { project, createdAt: Date.now() });
		writeProject(project, { ...readProject(project), [kind]: link });
		if (isId(current)) {
			writeJson(pathOf(current), {
				...readJson(pathOf(current)),
				project,
				replaced: true,
			});
			onRevoke(current);
			log(`${name} link replaced`);
		} else {
			log(`${name} link created`);
		}
		return link;
	};
	const viewOf = (project, reset = false) =>
		sideLinkOf('view', project, reset);
	const reviewOf = (project, reset = false) =>
		sideLinkOf('review', project, reset);

	// A new editing id; the previous one stops working.
	const replaceEdit = (project) => {
		const record = readProject(project);
		const previous = record.edit;
		const edit = crypto.randomUUID();
		writeJson(editPath(edit), { project, createdAt: Date.now() });
		writeProject(project, { ...record, edit });
		if (previous) {
			writeJson(editPath(previous), {
				...readJson(editPath(previous)),
				project,
				replaced: true,
			});
		}
		onRevoke(previous ?? project);
		log('editing link replaced');
		return edit;
	};

	const editOf = (project) => readProject(project).edit ?? project;

	const shareView = (body) => {
		const found = isProjectId(body.project) ? lookup(body.project) : null;
		if (!found || found.kind !== 'edit') {
			throw new HttpError(400, 'invalid_project');
		}
		if (found.access === 'replaced') throw new HttpError(403, 'link_replaced');
		return { view: viewOf(found.project, body.reset === true) };
	};

	const shareEdit = async (req, body) => {
		const found = lookup(body.project);
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		const { project } = found;
		let record = readProject(project);

		// Only someone holding the current editing link may claim a project.
		if (body.claim === true && !record.owner && found.access === 'edit') {
			record = { ...record, owner: account };
			writeProject(project, record);
			log('project owner set');
		}
		const role = roleOf(record, account);
		const edits = role === 'owner' || role === 'editor';
		const reviews = edits || role === 'reviewer';
		const views = reviews || role === 'reader';
		// Collaborators learn the current link from one that was replaced.
		const follows =
			found.kind === 'edit' ? edits : found.kind === 'review' ? reviews : views;
		if (found.access === 'replaced' && !follows) {
			throw new HttpError(403, 'link_replaced');
		}

		if (body.reset === true) {
			if (role !== 'owner') throw new HttpError(403, 'not_owner');
			replaceEdit(project);
		}

		return {
			owner: role === 'owner' ? 'you' : record.owner ? 'other' : 'none',
			role,
			...(edits ? { edit: editOf(project) } : {}),
			...(found.kind === 'review' && reviews
				? { review: reviewOf(project) }
				: {}),
			...(found.kind === 'view' && views ? { view: viewOf(project) } : {}),
		};
	};

	const listMembers = (record) =>
		Object.values(record.members ?? {})
			.map(({ username, role }) => ({ username, role }))
			.sort((a, b) => a.username.localeCompare(b.username));

	const linkOf = (project, role) =>
		role === 'editor'
			? editOf(project)
			: role === 'reviewer'
				? reviewOf(project)
				: viewOf(project);

	// An account made a member, or given another role; the project appears
	// in its list under the link of its role.
	const addMember = (project, member, role, { name, type } = {}) => {
		const record = readProject(project);
		const members = { ...record.members };
		if (
			!members[member.id] &&
			Object.keys(members).length >= MAX_MEMBERS
		) {
			throw new HttpError(413, 'too_many_members');
		}
		const previous = members[member.id]?.role;
		members[member.id] = {
			username: member.username,
			role,
			addedAt: Date.now(),
		};
		writeProject(project, { ...record, members });
		// Whoever is given less must not keep the link they had.
		if (previous === 'editor' && role !== 'editor') replaceEdit(project);
		if (
			previous === 'reviewer' &&
			role === 'reader' &&
			isReviewId(record.review)
		) {
			reviewOf(project, true);
		}
		const link = linkOf(project, role);
		const now = Date.now();
		return accounts.shareProject(member.username, {
			id: link,
			docUrl: `yjs:${link}`,
			name: typeof name === 'string' ? name : '',
			type: PROJECT_TYPES.includes(type) ? type : 'latex',
			createdAt: now,
			updatedAt: now,
		});
	};

	const shareMembers = async (req, body) => {
		// Readers and reviewers come by their own link.
		const found = lookup(body.project);
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		const { project } = found;
		const role = roleOf(readProject(project), account);
		// Every member sees who works on the project, to choose whose changes
		// are tracked, as on Overleaf; only the owner changes who does.
		const changes = Boolean(body.add) || typeof body.remove === 'string';
		if (role !== 'owner' && (changes || !role)) {
			throw new HttpError(403, 'not_owner');
		}

		let shared = null;
		if (body.add && typeof body.add === 'object') {
			const { role } = body.add;
			if (!ROLES.includes(role)) throw new HttpError(400, 'invalid_role');
			const member = accounts.findAccount(body.add.username);
			if (!member) throw new HttpError(404, 'unknown_user');
			if (member.id === account) throw new HttpError(400, 'already_owner');
			shared = addMember(project, member, role, body);
			log('collaborator added');
		} else if (typeof body.remove === 'string') {
			const record = readProject(project);
			const name = body.remove.trim().toLowerCase();
			const entry = Object.entries(record.members ?? {}).find(
				([, member]) => member.username.toLowerCase() === name,
			);
			if (!entry) throw new HttpError(404, 'unknown_member');
			const [id, member] = entry;
			const members = { ...record.members };
			delete members[id];
			writeProject(project, { ...record, members });
			if (member.role === 'editor') replaceEdit(project);
			else if (member.role === 'reviewer') {
				if (isReviewId(record.review)) reviewOf(project, true);
			} else if (isViewId(record.view)) viewOf(project, true);
			log('collaborator removed');
		}

		await shared;
		const record = readProject(project);
		const owner = accounts.usernameOf(record.owner);
		return {
			members: listMembers(record),
			...(owner ? { owner } : {}),
			// The editing link is the owner's to hand out.
			...(role === 'owner' ? { edit: editOf(project) } : {}),
		};
	};

	const dropInvite = (project, invite) => {
		fs.rmSync(invitePath(invite), { force: true });
		const record = readProject(project);
		if (!(record.invites ?? []).includes(invite)) return;
		writeProject(project, {
			...record,
			invites: record.invites.filter((entry) => entry !== invite),
		});
	};

	// A project's pending invitations, the expired ones forgotten.
	const pendingInvites = (project) => {
		const now = Date.now();
		const pending = [];
		for (const invite of readProject(project).invites ?? []) {
			const entry = readJson(invitePath(invite));
			if (entry?.project === project && entry.expiresAt > now) {
				const { role, createdAt, expiresAt } = entry;
				pending.push({ invite, role, createdAt, expiresAt });
			} else {
				dropInvite(project, invite);
			}
		}
		return pending;
	};

	const shareInvites = async (req, body) => {
		const found = isProjectId(body.project) ? lookup(body.project) : null;
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		const { project } = found;
		if (roleOf(readProject(project), account) !== 'owner') {
			throw new HttpError(403, 'not_owner');
		}

		let created = null;
		if (body.create && typeof body.create === 'object') {
			const { role } = body.create;
			if (!ROLES.includes(role)) throw new HttpError(400, 'invalid_role');
			if (pendingInvites(project).length >= MAX_INVITES) {
				throw new HttpError(413, 'too_many_invites');
			}
			const invite = crypto.randomBytes(24).toString('hex');
			const createdAt = Date.now();
			const expiresAt = createdAt + INVITE_MS;
			writeJson(invitePath(invite), {
				project,
				role,
				name: typeof body.name === 'string' ? body.name.slice(0, 200) : '',
				type: PROJECT_TYPES.includes(body.type) ? body.type : 'latex',
				createdAt,
				expiresAt,
			});
			const record = readProject(project);
			writeProject(project, {
				...record,
				invites: [...(record.invites ?? []), invite],
			});
			created = { invite, role, createdAt, expiresAt };
			log('invitation made');
		} else if (typeof body.revoke === 'string') {
			if (!INVITE_ID.test(body.revoke)) {
				throw new HttpError(400, 'invalid_invite');
			}
			dropInvite(project, body.revoke);
			log('invitation taken back');
		}
		return {
			...(created ? { invite: created } : {}),
			invites: pendingInvites(project),
		};
	};

	const acceptInvite = async (req, body) => {
		const invite =
			typeof body.invite === 'string' && INVITE_ID.test(body.invite)
				? body.invite
				: null;
		if (!invite) throw new HttpError(400, 'invalid_invite');
		const account = await accounts.identify(req);
		const entry = readJson(invitePath(invite));
		if (!entry || !isProjectId(entry.project)) {
			throw new HttpError(404, 'unknown_invite');
		}
		const { project, role } = entry;
		if (!(entry.expiresAt > Date.now())) {
			dropInvite(project, invite);
			throw new HttpError(410, 'expired_invite');
		}
		if (readProject(project).owner === account) {
			throw new HttpError(400, 'already_owner');
		}
		const username = accounts.usernameOf(account);
		if (!username || !ROLES.includes(role)) {
			throw new HttpError(404, 'unknown_invite');
		}
		// Used once: gone before the member is added, so that two openings
		// of the link cannot both add someone.
		dropInvite(project, invite);
		await addMember(project, { id: account, username }, role, entry);
		log('invitation accepted');
		return {
			project: linkOf(project, role),
			role,
			name: entry.name,
			type: entry.type,
		};
	};

	// Who owns a project an account lists: "you", "other" (with their
	// name) or "none".
	const describe = (account, entry) => {
		const found = lookup(entry.editId ?? entry.id);
		if (!found) return {};
		const { owner } = readProject(found.project);
		if (!owner) return { owner: 'none' };
		if (owner === account) return { owner: 'you' };
		const ownerName = accounts.usernameOf(owner);
		return ownerName ? { owner: 'other', ownerName } : { owner: 'other' };
	};

	const shareCopy = async (req, body) => {
		const found = lookup(body.project);
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		if (found.access === 'replaced') throw new HttpError(403, 'link_replaced');
		if (!copyProject) throw new HttpError(501, 'copy_unavailable');
		const project = crypto.randomUUID();
		const name = typeof body.name === 'string' ? body.name.slice(0, 300) : '';
		if (!(await copyProject(found.project, project, { name }))) {
			throw new HttpError(404, 'unknown_project');
		}
		writeProject(project, { owner: account });
		log('project copied');
		return { project };
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
		'/share/view': (_req, body) => shareView(body),
		'/share/edit': (req, body) => shareEdit(req, body),
		'/share/members': (req, body) => shareMembers(req, body),
		'/share/copy': (req, body) => shareCopy(req, body),
		'/share/invites': (req, body) => shareInvites(req, body),
		'/share/accept': (req, body) => acceptInvite(req, body),
	};

	const handles = (url) => Object.hasOwn(routes, url);

	const handle = async (req, res, url) => {
		const reply = (status, body) => {
			res.writeHead(status, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			});
			res.end(JSON.stringify(body));
		};

		if (req.method !== 'POST') {
			req.resume();
			reply(405, { error: 'method_not_allowed' });
			return;
		}
		try {
			const body = await readBody(req);
			reply(200, await routes[url](req, body));
		} catch (error) {
			// Errors from the accounts (signed out...) carry a status too.
			if (
				Number.isInteger(error?.status) &&
				typeof error.code === 'string'
			) {
				reply(error.status, { error: error.code });
				return;
			}
			log('share request failed', error);
			reply(500, { error: 'server_error' });
		}
	};

	return { handles, handle, lookup, describe };
};

module.exports = { createShares, isViewId, isReviewId };
