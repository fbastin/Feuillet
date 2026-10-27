// server/collab/shares.js
// Read-only links to projects, as on Overleaf. A view id stands for a
// project: whoever opens it receives the project's documents and files, but
// the server drops everything they send to change them.
//
//   POST /share/view {project}               -> {view}, the same each time
//   POST /share/view {project, reset: true}  -> {view}, a new one; the old
//                                               one stops working
//
// Knowing a project id is what lets someone edit the project, so it is also
// what lets them create or replace its read-only link. A view id does not
// reveal the project id.
//
// SHARES_DIR keeps one file per project (projects/<project>.json: {view}) and
// one per view (views/<view>.json: {project}).

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

const createShares = ({ dir, log, onRevoke = () => {} }) => {
	const projectsDir = path.join(dir, 'projects');
	const viewsDir = path.join(dir, 'views');
	fs.mkdirSync(projectsDir, { recursive: true });
	fs.mkdirSync(viewsDir, { recursive: true });

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

	// The project a view id opens, or null when it opens nothing.
	const resolve = (view) => {
		if (!isViewId(view)) return null;
		const project = readJson(viewPath(view))?.project;
		return typeof project === 'string' && PROJECT_ID.test(project)
			? project
			: null;
	};

	const viewOf = (project, reset) => {
		const current = readJson(projectPath(project))?.view;
		if (isViewId(current) && !reset) return current;

		const view = `view${crypto.randomBytes(16).toString('hex')}`;
		writeJson(viewPath(view), { project, createdAt: Date.now() });
		writeJson(projectPath(project), { view });
		if (isViewId(current)) {
			fs.rmSync(viewPath(current), { force: true });
			onRevoke(current);
			log('read-only link replaced');
		} else {
			log('read-only link created');
		}
		return view;
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

	const handles = (url) => url === '/share/view';

	const handle = async (req, res) => {
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
			const project = body.project;
			// A view id cannot have a read-only link of its own.
			if (
				typeof project !== 'string' ||
				!PROJECT_ID.test(project) ||
				isViewId(project)
			) {
				throw new HttpError(400, 'invalid_project');
			}
			reply(200, { view: viewOf(project, body.reset === true) });
		} catch (error) {
			if (error instanceof HttpError) {
				reply(error.status, { error: error.code });
				return;
			}
			log('share request failed', error);
			reply(500, { error: 'server_error' });
		}
	};

	return { handles, handle, resolve };
};

module.exports = { createShares, isViewId };
