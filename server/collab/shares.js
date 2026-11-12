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
// link, which cuts them off. A member may also leave a project, as on
// Overleaf, with the same effect. Either way the project leaves their list.
//
//   POST /share/view {project}               -> {view}, the same each time
//   POST /share/view {project, reset: true}  -> {view}, a new one; the old
//                                               one stops working
//   POST /share/edit {project}       (token) -> {owner, role, edit, view}
//   POST /share/edit {project, claim: true}     the account becomes the owner
//                                               if the project has none
//   POST /share/edit {project, reset: true}     (owner) a new editing id; the
//                                               old one stops working
//   POST /share/members {project}    (token) -> {members, visitors, owner},
//                                    for any member and whoever edits or
//                                    reviews by a link, as Overleaf shows
//                                    collaborators; `visitors`, the accounts
//                                    that list the project by a link given
//                                    them, with its access
//   POST /share/members {project, add: {username, role}, name, type}
//   POST /share/members {project, remove: username}
//   POST /share/members {project, transfer: username, name, type}
//                                    (owner) the member becomes the owner and
//                                    the owner an editor, as Overleaf's
//                                    "Make owner"
//   POST /share/leave {project}      (token) -> {left: true}: no longer a
//                                    member, nor listing it; not the owner
//   POST /share/delete {project}     (token) -> {deleted: true}: the owner
//                                    deletes the project for good
//   POST /share/copy {project, name} (token) -> {project}, a copy of the
//                                               project the account owns
//   POST /share/invites {project}    (token) -> {invites, sends}, for the
//                                    owner; `sends` tells whether Feuillet
//                                    mails invitations: "yes", "unconfirmed"
//                                    (not until the owner's email address is
//                                    confirmed) or "no" (no mail server)
//   POST /share/invites {project, create: {role}, name, type, email} ->
//                                    {invite, invites}: a personal invitation
//                                    link, and the address it is mailed to
//   ... with send: true, language    and Feuillet mails it there: {mailed:
//                                    true}, or {mailError} when it could not
//   POST /share/invites {project, resend: invite, language} -> {mailed} or
//                                    {mailError}: the invitation mailed again
//   POST /share/invites {project, revoke: invite} -> {invites}
//   POST /share/accept {invite}      (token) -> {project, role, name, type}:
//                                    the account becomes a member
//   POST /share/request {project, role, name, language} (token) ->
//                                    {requested}: asks the owner for more
//                                    access, as Overleaf's "Request access"
//   POST /share/request {project, cancel: true} (token) -> {requested: null}
//   POST /share/members {project, grant: username, name, type} (owner): the
//                                    request granted, the account a member
//                                    with the role it asked for
//   POST /share/members {project, decline: username} (owner)
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
// Invitations, as Overleaf's by email: the owner makes a link for a role,
// and Feuillet mails it to the address given, or the owner sends it; whoever
// opens it signed in, with an account made then if need be, becomes a member
// with that role. A link works once, for 30 days, and its owner may take it
// back before. Feuillet mails invitations only for an owner whose own email
// address is confirmed, at most MAX_INVITE_MAILS a day for each owner (and
// within mail.js's limits), and never says to whom an address belongs.
//
// Access requests, as Overleaf's: whoever reads a project, as a member or
// by a link, may ask its owner to review or edit it, and whoever reviews
// it to edit it. The owner is told by email (at most once a day for one
// account's request) and by the count on the Share button
// (/share/edit's `requests`), and grants or declines in the share dialog
// (/share/members `requests`); the account is told the answer by email.
// Granted, it becomes a member with that role, its list naming the project
// by that role's link in place of the one it had. One request by account;
// one already met (the account an editor since) is no longer listed.
//
// Deleting a project for good, as on Overleaf, erases its documents, files
// and versions (`eraseProject`, given by the server), takes it off every
// list, and leaves only {deleted: true} in its file, so that none of its
// links opens anything again, nor makes a new project under its id. Deleting
// an account deletes the projects it owns.
//
// SHARES_DIR keeps one file per project (projects/<project>.json: {view,
// review, edit, owner, members, invites}), one per read-only link
// (views/<view>.json: {project, replaced}), one per review link
// (reviews/<review>.json: the same), one per editing id given out
// (edits/<edit>.json: the same) and one per pending invitation
// (invites/<invite>.json: {project, role, name, type, createdAt,
// expiresAt}). A project's file keeps its access requests too (requests:
// {account: {username, role, name, createdAt, mailedAt}}).

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
// Invitations one owner may have mailed in 24 hours.
const MAX_INVITE_MAILS = 30;
// Access requests a project keeps at once.
const MAX_REQUESTS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PROJECT_TYPES = ['latex', 'typst'];

class HttpError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

// A project's name as a device gives it, kept on one line.
const projectName = (name) =>
	typeof name === 'string'
		? name
				// biome-ignore lint/suspicious/noControlCharactersInRegex: removes them.
				.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
				.trim()
				.slice(0, 200)
		: '';

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
	eraseProject = async () => {},
	mailer = null,
	appUrl = '',
}) => {
	const appBase = String(appUrl).replace(/\/+$/, '');
	// When each owner had an invitation mailed, these 24 hours.
	const inviteMails = new Map();
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
		const found = lookupLink(id);
		// A project deleted for good opens nothing, by any of its links.
		return found && readJson(projectPath(found.project))?.deleted
			? null
			: found;
	};

	const lookupLink = (id) => {
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

		const asked = pendingRequests(record);
		const mine = asked.find(([id]) => id === account)?.[1];
		return {
			owner: role === 'owner' ? 'you' : record.owner ? 'other' : 'none',
			role,
			...(role === 'owner' ? { requests: asked.length } : {}),
			...(mine ? { requested: mine.role } : {}),
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

	// The access requests still to decide: not the owner's, nor met since
	// (the account given that role or more), oldest first.
	const pendingRequests = (record) =>
		Object.entries(record.requests ?? {})
			.filter(([id, request]) => {
				if (id === record.owner) return false;
				const role = record.members?.[id]?.role;
				return !(
					role === 'editor' ||
					(role === 'reviewer' && request.role === 'reviewer')
				);
			})
			.sort(([, a], [, b]) => a.createdAt - b.createdAt);
	const listRequests = (record) =>
		pendingRequests(record).map(([, { username, role, createdAt }]) => ({
			username,
			role,
			createdAt,
		}));

	// The links an account's list names a project by.
	const linkIdsOf = (entry) =>
		[
			entry.editId,
			/^yjs:([A-Za-z0-9_-]+)/.exec(String(entry.docUrl ?? ''))?.[1],
			entry.id,
		].filter((id, index, all) => id && all.indexOf(id) === index);

	/**
	 * Accounts that keep a project in their list by a link they were given,
	 * not invited, as Overleaf lists who joined by link sharing: noted with
	 * the access of the link, from each list a device sends, and forgotten
	 * when the project leaves it.
	 */
	const noteListed = (account, entries, before = {}) => {
		for (const entry of entries) {
			// A removed entry keeps only its id: its links are in the list
			// as it was.
			const named = entry.deleted ? (before[entry.id] ?? entry) : entry;
			let found = null;
			for (const id of linkIdsOf(named)) {
				found = lookup(id);
				if (found) break;
			}
			if (!found) continue;
			const record = readProject(found.project);
			const known = record.visitors?.[account];
			const gone = entry.deleted || found.access === 'replaced';
			if (gone || record.owner === account || record.members?.[account]) {
				if (known) {
					const { [account]: _dropped, ...others } = record.visitors;
					writeProject(found.project, { ...record, visitors: others });
				}
				continue;
			}
			if (known?.access === found.access) continue;
			writeProject(found.project, {
				...record,
				visitors: {
					...(record.visitors ?? {}),
					[account]: { access: found.access, since: known?.since ?? Date.now() },
				},
			});
		}
	};

	const listVisitors = (record) =>
		Object.entries(record.visitors ?? {})
			.filter(([id]) => id !== record.owner && !record.members?.[id])
			.map(([id, { access, since }]) => ({
				username: accounts.usernameOf(id),
				access,
				since,
			}))
			.filter((visitor) => visitor.username)
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

	// Whether an entry of an account's list names this project, by any of
	// the links it keeps (mcp.js reads them the same way).
	const linksOf = (entry) =>
		[
			entry.editId,
			/^yjs:([A-Za-z0-9_-]+)/.exec(String(entry.docUrl ?? ''))?.[1],
			entry.id,
		].filter((id) => typeof id === 'string');
	const names = (project) => (entry) =>
		// Deleted projects too, whose links no longer open them.
		linksOf(entry).some((id) => lookupLink(id)?.project === project);
	// The projects an entry of an account's list names.
	const projectsNamedBy = (entry) =>
		new Set(
			linksOf(entry)
				.map((id) => lookupLink(id)?.project)
				.filter(Boolean),
		);

	// A member gone, removed by the owner or leaving: the link of their role
	// is replaced, which cuts them off, and the project leaves their list.
	const dropMember = async (project, id) => {
		const record = readProject(project);
		const member = record.members?.[id];
		if (!member) return null;
		const members = { ...record.members };
		delete members[id];
		writeProject(project, { ...record, members });
		if (member.role === 'editor') replaceEdit(project);
		else if (member.role === 'reviewer') {
			if (isReviewId(record.review)) reviewOf(project, true);
		} else if (isViewId(record.view)) viewOf(project, true);
		await accounts.unshareProject(member.username, names(project));
		return member;
	};

	const shareMembers = async (req, body) => {
		// Readers and reviewers come by their own link.
		const found = lookup(body.project);
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		const { project } = found;
		const role = roleOf(readProject(project), account);
		// Every member sees who works on the project, to choose whose changes
		// are tracked, as on Overleaf, and so does whoever edits or reviews it
		// through a link; only the owner changes who does.
		const changes =
			Boolean(body.add) ||
			typeof body.remove === 'string' ||
			typeof body.transfer === 'string' ||
			typeof body.grant === 'string' ||
			typeof body.decline === 'string';
		const reachesByLink = found.access === 'edit' || found.access === 'review';
		if (changes ? role !== 'owner' : !(role || reachesByLink)) {
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
			await dropMember(project, entry[0]);
			log('collaborator removed');
		} else if (typeof body.transfer === 'string') {
			await transferOwnership(project, account, body.transfer, body);
			log('project owner changed');
		} else if (typeof body.grant === 'string' || typeof body.decline === 'string') {
			shared = decideRequest(project, account, body);
		}

		await shared;
		const record = readProject(project);
		const owner = accounts.usernameOf(record.owner);
		return {
			members: listMembers(record),
			visitors: listVisitors(record),
			...(record.owner === account ? { requests: listRequests(record) } : {}),
			...(owner ? { owner } : {}),
			// The editing link is the owner's to hand out.
			...(record.owner === account ? { edit: editOf(project) } : {}),
		};
	};

	// A member made the owner, as Overleaf's "Make owner": the owner stays
	// on as an editor. A new owner who was not an editor gets the editing
	// link in their list, in place of the one of their role.
	const transferOwnership = async (project, owner, username, { name, type }) => {
		const record = readProject(project);
		const wanted = username.trim().toLowerCase();
		const entry = Object.entries(record.members ?? {}).find(
			([, member]) => member.username.toLowerCase() === wanted,
		);
		if (!entry) throw new HttpError(404, 'unknown_member');
		const [id, member] = entry;
		const ownerName = accounts.usernameOf(owner);
		if (!ownerName) throw new HttpError(409, 'owner_unknown');

		const members = { ...record.members };
		delete members[id];
		members[owner] = { username: ownerName, role: 'editor', addedAt: Date.now() };
		writeProject(project, { ...record, owner: id, members });

		if (member.role !== 'editor') {
			await accounts.unshareProject(member.username, names(project));
			const link = editOf(project);
			const now = Date.now();
			await accounts.shareProject(member.username, {
				id: link,
				docUrl: `yjs:${link}`,
				name: typeof name === 'string' ? name : '',
				type: PROJECT_TYPES.includes(type) ? type : 'latex',
				createdAt: now,
				updatedAt: now,
			});
		}
	};

	// What an account reaches a project with: by its role, or by the link it
	// opened it with; null by a replaced link, for someone no member.
	const reachOf = (record, account, found) => {
		const role = roleOf(record, account);
		if (role === 'owner' || role === 'editor' || found.access === 'edit') {
			return 'edit';
		}
		if (role === 'reviewer' || found.access === 'review') return 'review';
		if (role === 'reader' || found.access === 'view') return 'view';
		return null;
	};

	const shareRequest = async (req, body) => {
		const found = lookup(body.project);
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		const { project } = found;
		const record = readProject(project);
		const requests = { ...(record.requests ?? {}) };
		if (body.cancel === true) {
			if (requests[account]) {
				delete requests[account];
				writeProject(project, { ...record, requests });
				log('access request withdrawn');
			}
			return { requested: null };
		}
		const reach = reachOf(record, account, found);
		if (!reach) throw new HttpError(403, 'link_replaced');
		if (reach === 'edit') throw new HttpError(400, 'has_access');
		const role = body.role;
		const allowed = reach === 'view' ? ['reviewer', 'editor'] : ['editor'];
		if (!allowed.includes(role)) throw new HttpError(400, 'invalid_role');
		if (!record.owner) throw new HttpError(409, 'no_owner');
		const username = accounts.usernameOf(account);
		if (!username) throw new HttpError(401, 'signed_out');
		const previous = requests[account];
		if (!previous && pendingRequests(record).length >= MAX_REQUESTS) {
			throw new HttpError(413, 'too_many_requests');
		}
		const now = Date.now();
		// The owner is told once a day at most of one account's request.
		const tell = previous?.role !== role || !(previous?.mailedAt > now - DAY_MS);
		const name = projectName(body.name) || previous?.name || '';
		requests[account] = {
			username,
			role,
			name,
			createdAt: previous?.role === role ? previous.createdAt : now,
			mailedAt: tell ? now : previous.mailedAt,
		};
		writeProject(project, { ...record, requests });
		log('access requested');
		const contact = tell && mailer ? accounts.reviewContactOf(record.owner) : null;
		if (contact?.email) {
			mailer
				.send('access-request', {
					to: contact.email,
					language: contact.language,
					username: accounts.usernameOf(record.owner) ?? '',
					inviter: username,
					project: name,
					role,
					link: `${appBase}/#yjs:${editOf(project)}`,
				})
				.catch(() => {});
		}
		return { requested: role };
	};

	// The owner's answer: granted, the account becomes a member with the
	// role it asked for, its list naming the project by that role's link in
	// place of the one it had (as for a new owner); the account is told.
	const decideRequest = async (project, owner, body) => {
		const granted = typeof body.grant === 'string';
		const wanted = String(granted ? body.grant : body.decline)
			.trim()
			.toLowerCase();
		const record = readProject(project);
		const entry = pendingRequests(record).find(
			([, request]) => request.username.toLowerCase() === wanted,
		);
		if (!entry) throw new HttpError(404, 'unknown_request');
		const [id, request] = entry;
		const { [id]: _decided, ...others } = record.requests;
		writeProject(project, { ...record, requests: others });
		const username = accounts.usernameOf(id);
		if (!username) return;
		if (granted) {
			await accounts.unshareProject(username, names(project));
			await addMember(project, { id, username }, request.role, {
				name: projectName(body.name) || request.name,
				type: body.type,
			});
		}
		log(granted ? 'access request granted' : 'access request declined');
		const contact = mailer ? accounts.reviewContactOf(id) : null;
		if (!contact?.email) return;
		mailer
			.send('access-decision', {
				to: contact.email,
				language: contact.language,
				username,
				inviter: accounts.usernameOf(owner) ?? '',
				project: projectName(body.name) || request.name,
				role: request.role,
				why: granted ? 'granted' : 'declined',
				link: granted
					? `${appBase}/#yjs:${linkOf(project, request.role)}`
					: `${appBase}/`,
			})
			.catch(() => {});
	};

	// Leaving a project shared with one, as Overleaf's "Leave". Someone who
	// came by a link only, without being a member, just stops listing it.
	const shareLeave = async (req, body) => {
		const found = lookup(body.project);
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		const { project } = found;
		const record = readProject(project);
		const role = roleOf(record, account);
		if (role === 'owner') throw new HttpError(400, 'owner_cannot_leave');
		if (record.requests?.[account]) {
			const { [account]: _dropped, ...requests } = record.requests;
			writeProject(project, { ...record, requests });
		}
		if (role) {
			await dropMember(project, account);
			log('collaborator left');
		} else {
			const username = accounts.usernameOf(account);
			if (username) await accounts.unshareProject(username, names(project));
			log('shared project left');
		}
		return { left: true };
	};

	// Deletes a project for good: no link opens it from now on, those
	// connected are cut off, its contents are erased, and it leaves the
	// lists of its owner and members (but `keep`'s, whose account is going).
	const deleteProject = async (project, keep = null) => {
		const record = readProject(project);
		if (record.deleted) return;
		writeProject(project, { deleted: true, deletedAt: Date.now() });
		for (const invite of record.invites ?? []) {
			fs.rmSync(invitePath(invite), { force: true });
		}
		for (const id of [project, record.edit, record.view, record.review]) {
			if (id) onRevoke(id);
		}
		await eraseProject(project);
		const people = [
			...(record.owner && record.owner !== keep ? [record.owner] : []),
			...Object.keys(record.members ?? {}).filter((id) => id !== keep),
		];
		for (const id of people) {
			const username = accounts.usernameOf(id);
			if (username) await accounts.unshareProject(username, names(project));
		}
		log('project deleted');
	};

	const shareDelete = async (req, body) => {
		const found = lookup(body.project);
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		const { project } = found;
		const record = readProject(project);
		// Its owner, or for a project nobody claimed, whoever holds its
		// current editing link (who could claim it).
		const allowed =
			record.owner === account ||
			(!record.owner && found.access === 'edit');
		if (!allowed) throw new HttpError(403, 'not_owner');
		await deleteProject(project);
		return { deleted: true };
	};

	// An account deleted: the projects it owns go with it, and it leaves
	// those it was a member of.
	const forgetAccount = async (account) => {
		for (const file of fs.readdirSync(projectsDir)) {
			if (!file.endsWith('.json')) continue;
			const project = file.slice(0, -5);
			if (!isProjectId(project)) continue;
			const record = readProject(project);
			if (record.deleted) continue;
			if (record.owner === account) {
				await deleteProject(project, account);
				continue;
			}
			if (record.members?.[account] || record.visitors?.[account]) {
				const members = { ...record.members };
				delete members[account];
				const visitors = { ...record.visitors };
				delete visitors[account];
				writeProject(project, { ...record, members, visitors });
			}
		}
	};

	// For the administration page (admin.js): deletes a project for good,
	// or erases what remains of one deleted.
	const purge = async (project) => {
		if (!isProjectId(project)) return;
		if (readProject(project).deleted) await eraseProject(project);
		else await deleteProject(project);
	};

	// Every project, with its owner and members, and whether it was
	// deleted, for the administration page (admin.js).
	const census = () => {
		const projects = [];
		for (const file of fs.readdirSync(projectsDir)) {
			if (!file.endsWith('.json')) continue;
			const project = file.slice(0, -5);
			if (!isProjectId(project)) continue;
			let record;
			try {
				record = readProject(project);
			} catch {
				continue;
			}
			projects.push({
				project,
				owner: record.owner ?? null,
				members: Object.keys(record.members ?? {}),
				deleted: record.deleted === true,
			});
		}
		return projects;
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
				const { role, createdAt, expiresAt, email } = entry;
				pending.push({
					invite,
					role,
					createdAt,
					expiresAt,
					...(email ? { email } : {}),
				});
			} else {
				dropInvite(project, invite);
			}
		}
		return pending;
	};

	// Whether Feuillet mails this owner's invitations.
	const sendsFor = (account) =>
		!mailer ? 'no' : accounts.hasConfirmedEmail(account) ? 'yes' : 'unconfirmed';

	// Mails an invitation; the reason when it cannot.
	const mailInvite = async (account, invite, entry, language) => {
		const sends = sendsFor(account);
		if (sends !== 'yes') {
			return { mailError: sends === 'no' ? 'mail_disabled' : 'email_unconfirmed' };
		}
		const since = Date.now() - DAY_MS;
		const recent = (inviteMails.get(account) ?? []).filter((at) => at > since);
		if (recent.length >= MAX_INVITE_MAILS) return { mailError: 'mail_quota' };
		inviteMails.set(account, [...recent, Date.now()]);
		try {
			await mailer.send('invite', {
				to: entry.email,
				language,
				inviter: accounts.usernameOf(account) ?? '',
				project: entry.name,
				type: entry.type,
				role: entry.role,
				link: `${appBase}/#invite:${invite}`,
			});
			return { mailed: true };
		} catch (error) {
			return {
				mailError: error?.code === 'mail_quota' ? 'mail_quota' : 'mail_failed',
			};
		}
	};

	const shareInvites = async (req, body) => {
		const found = isProjectId(body.project) ? lookup(body.project) : null;
		if (!found) throw new HttpError(400, 'invalid_project');
		const account = await accounts.identify(req);
		const { project } = found;
		if (roleOf(readProject(project), account) !== 'owner') {
			throw new HttpError(403, 'not_owner');
		}
		const language = /^fr\b/i.test(String(body.language ?? '')) ? 'fr' : 'en';

		let created = null;
		let mailing = {};
		if (body.create && typeof body.create === 'object') {
			const { role } = body.create;
			if (!ROLES.includes(role)) throw new HttpError(400, 'invalid_role');
			if (pendingInvites(project).length >= MAX_INVITES) {
				throw new HttpError(413, 'too_many_invites');
			}
			const invite = crypto.randomBytes(24).toString('hex');
			const createdAt = Date.now();
			const expiresAt = createdAt + INVITE_MS;
			// The address it is mailed to, to tell pending ones apart.
			const email =
				typeof body.email === 'string' &&
				body.email.length <= 254 &&
				/^[^\s@]+@[^\s@]+$/.test(body.email)
					? body.email
					: undefined;
			const entry = {
				project,
				role,
				...(email ? { email } : {}),
				name: typeof body.name === 'string' ? body.name.slice(0, 200) : '',
				type: PROJECT_TYPES.includes(body.type) ? body.type : 'latex',
				createdAt,
				expiresAt,
			};
			writeJson(invitePath(invite), entry);
			const record = readProject(project);
			writeProject(project, {
				...record,
				invites: [...(record.invites ?? []), invite],
			});
			created = {
				invite,
				role,
				createdAt,
				expiresAt,
				...(email ? { email } : {}),
			};
			log('invitation made');
			if (body.send === true) {
				mailing = EMAIL.test(email ?? '')
					? await mailInvite(account, invite, entry, language)
					: { mailError: 'invalid_email' };
			}
		} else if (typeof body.resend === 'string') {
			if (!INVITE_ID.test(body.resend)) {
				throw new HttpError(400, 'invalid_invite');
			}
			const entry = readJson(invitePath(body.resend));
			if (
				entry?.project !== project ||
				!(entry.expiresAt > Date.now()) ||
				!(readProject(project).invites ?? []).includes(body.resend)
			) {
				throw new HttpError(404, 'unknown_invite');
			}
			mailing = EMAIL.test(entry.email ?? '')
				? await mailInvite(account, body.resend, entry, language)
				: { mailError: 'invalid_email' };
		} else if (typeof body.revoke === 'string') {
			if (!INVITE_ID.test(body.revoke)) {
				throw new HttpError(400, 'invalid_invite');
			}
			dropInvite(project, body.revoke);
			log('invitation taken back');
		}
		return {
			...(created ? { invite: created } : {}),
			...mailing,
			invites: pendingInvites(project),
			sends: sendsFor(account),
		};
	};

	// Whether a personal invitation is pending: whoever has it may make an
	// account where invitations are needed for that (accounts.js).
	const inviteOpen = (invite) => {
		if (typeof invite !== 'string' || !INVITE_ID.test(invite)) return false;
		const entry = readJson(invitePath(invite));
		return Boolean(
			entry && isProjectId(entry.project) && entry.expiresAt > Date.now(),
		);
	};
	accounts.setInviteChecker?.(inviteOpen);

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
	// What an account may do with a project it lists under this id: "edit",
	// "review" or "view", by its role if it is a member, or else by the link
	// it holds; with the id the project is stored under. Null when nothing.
	const accessOf = (account, id) => {
		const found = lookup(id);
		if (!found) return null;
		const role = roleOf(readProject(found.project), account);
		const byRole =
			role === 'owner' || role === 'editor'
				? 'edit'
				: role === 'reviewer'
					? 'review'
					: role === 'reader'
						? 'view'
						: null;
		const byLink = found.access === 'replaced' ? null : found.access;
		const rank = { view: 1, review: 2, edit: 3 };
		const access = [byRole, byLink]
			.filter(Boolean)
			.sort((a, b) => rank[b] - rank[a])[0];
		return access ? { project: found.project, access, role } : null;
	};

	// The account that owns the project a link opens, unless the link was
	// replaced; for compiling by that link (compileTickets.js).
	const ownerOf = (id) => {
		const found = lookup(id);
		if (!found || found.access === 'replaced') return null;
		return readProject(found.project).owner ?? null;
	};

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
		'/share/leave': (req, body) => shareLeave(req, body),
		'/share/delete': (req, body) => shareDelete(req, body),
		'/share/copy': (req, body) => shareCopy(req, body),
		'/share/invites': (req, body) => shareInvites(req, body),
		'/share/accept': (req, body) => acceptInvite(req, body),
		'/share/request': (req, body) => shareRequest(req, body),
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

	return {
		handles,
		handle,
		lookup,
		ownerOf,
		describe,
		noteListed,
		accessOf,
		forgetAccount,
		census,
		projectsNamedBy,
		purge,
	};
};

module.exports = { createShares, isViewId, isReviewId };
