// server/collab/shares.js
// Links to projects, as on Overleaf.
//
// Editing: a project opens under the id it was created with, until its owner
// replaces its editing link; from then on it opens under the new id only, and
// whoever kept an older one is cut off. Its documents and files stay stored
// under the id it was created with.
//
// Read-only: a view id opens the project too, but the server drops whatever
// is sent through it to change the project.
//
//   POST /share/view {project}               -> {view}, the same each time
//   POST /share/view {project, reset: true}  -> {view}, a new one; the old
//                                               one stops working
//   POST /share/edit {project}       (token) -> {owner, edit}
//   POST /share/edit {project, claim: true}     the account becomes the owner
//                                               if the project has none
//   POST /share/edit {project, reset: true}     (owner only) a new editing
//                                               id; the old one stops working
//
// `project` is an editing id. Knowing one is what lets someone edit the
// project, so it also lets them create or replace its read-only link. Only
// the owner, a Feuillet account, may replace the editing link, and may name
// the project by an editing id that no longer opens it to learn the current
// one. `owner` is "you", "other" or "none"; `edit`, the current editing id,
// goes to the owner only.
//
// SHARES_DIR keeps one file per project (projects/<project>.json: {view,
// edit, owner}), one per read-only link (views/<view>.json: {project}) and one
// per editing id given out (edits/<edit>.json: {project, replaced}).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BODY_BYTES = 4096;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,100}$/;
// Project ids are UUIDs, which never start with "view".
const VIEW_ID = /^view[0-9a-f]{32}$/;

class HttpError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

const isViewId = (id) => VIEW_ID.test(id);
const isProjectId = (id) =>
	typeof id === 'string' && PROJECT_ID.test(id) && !isViewId(id);

const createShares = ({ dir, log, identify, onRevoke = () => {} }) => {
	const projectsDir = path.join(dir, 'projects');
	const viewsDir = path.join(dir, 'views');
	const editsDir = path.join(dir, 'edits');
	for (const folder of [projectsDir, viewsDir, editsDir]) {
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
	const editPath = (edit) => path.join(editsDir, `${edit}.json`);

	// What an id opens: {project, access}, where `project` is the id the
	// project's documents and files are stored under and `access` is "edit",
	// "view" or "replaced" (the id opened the project until its link was
	// replaced); null when it opens nothing.
	const lookup = (id) => {
		if (typeof id !== 'string' || !PROJECT_ID.test(id)) return null;
		if (isViewId(id)) {
			const project = readJson(viewPath(id))?.project;
			return isProjectId(project) ? { project, access: 'view' } : null;
		}
		const given = readJson(editPath(id));
		if (given) {
			return isProjectId(given.project)
				? {
						project: given.project,
						access: given.replaced ? 'replaced' : 'edit',
					}
				: null;
		}
		return readJson(projectPath(id))?.edit
			? { project: id, access: 'replaced' }
			: { project: id, access: 'edit' };
	};

	// The editing id a request names, as the project it opens.
	const projectNamed = (id) => {
		const found = isProjectId(id) ? lookup(id) : null;
		if (!found || found.access === 'view') {
			throw new HttpError(400, 'invalid_project');
		}
		return found;
	};

	const viewOf = (project, reset) => {
		const record = readJson(projectPath(project)) ?? {};
		const current = record.view;
		if (isViewId(current) && !reset) return current;

		const view = `view${crypto.randomBytes(16).toString('hex')}`;
		writeJson(viewPath(view), { project, createdAt: Date.now() });
		writeJson(projectPath(project), { ...record, view });
		if (isViewId(current)) {
			fs.rmSync(viewPath(current), { force: true });
			onRevoke(current);
			log('read-only link replaced');
		} else {
			log('read-only link created');
		}
		return view;
	};

	const shareView = (body) => {
		const found = projectNamed(body.project);
		if (found.access === 'replaced') throw new HttpError(403, 'link_replaced');
		return { view: viewOf(found.project, body.reset === true) };
	};

	const shareEdit = async (req, body) => {
		const found = projectNamed(body.project);
		const owner = await identify(req);
		const { project } = found;
		const record = readJson(projectPath(project)) ?? {};

		if (body.claim === true && !record.owner) {
			record.owner = owner;
			writeJson(projectPath(project), record);
			log('project owner set');
		}
		const mine = record.owner === owner;
		if (found.access === 'replaced' && !mine) {
			throw new HttpError(403, 'link_replaced');
		}

		if (body.reset === true) {
			if (!mine) throw new HttpError(403, 'not_owner');
			const previous = record.edit;
			const edit = crypto.randomUUID();
			writeJson(editPath(edit), { project, createdAt: Date.now() });
			record.edit = edit;
			writeJson(projectPath(project), record);
			if (previous) {
				writeJson(editPath(previous), {
					...readJson(editPath(previous)),
					project,
					replaced: true,
				});
			}
			onRevoke(previous ?? project);
			log('editing link replaced');
		}

		return {
			owner: mine ? 'you' : record.owner ? 'other' : 'none',
			...(mine ? { edit: record.edit ?? project } : {}),
		};
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

	return { handles, handle, lookup };
};

module.exports = { createShares, isViewId };
