// server/collab/history.js
// Versions of each project, as on Overleaf: a short while after its
// documents or files change, the server saves a version listing the text of
// every document and the checksum of every other file, with the names of
// those who made the changes. Texts are stored with the project's files, by
// SHA-256, so a text that did not change is not stored again.
//
// Versions can be labelled, like "Submitted"; labelled versions are kept
// for good, the others up to the latest 1000.
//
//   GET    /history/<id>             -> {versions, labels}: versions newest
//                                       first, {id, time, authors, changes:
//                                       [{path, type}]}; labels {id, version,
//                                       name, by, time}
//   GET    /history/<id>/<version>   -> {id, time, authors, docs: [{id, path,
//                                       hash, size}], files: [{path, hash,
//                                       size}]}
//   POST   /history/<id>/labels {name, by, version}  -> {label}; without a
//                                       version, the project as it is now
//   DELETE /history/<id>/labels/<label>
//
// <id> is any id that opens the project (an editing id or a read-only link);
// labels are added and removed through an editing id. Contents come from
// /files/<id>/<hash>.
//
// HISTORY_DIR keeps, per project, index.json (the list), labels.json and one
// file per version.
//
// Comments and tracked changes live in the text as tags; a document whose
// text changed only in its tags (a comment added, answered or resolved) did
// not change, as on Overleaf, so its stored text keeps the tags for restoring
// but is compared without them (textHash).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION_ID = /^[0-9]{13}-[0-9a-f]{8}$/;
const ROUTE =
	/^\/history\/([A-Za-z0-9_-]{1,100})(?:\/([0-9]{13}-[0-9a-f]{8})|(\/labels)(?:\/([0-9a-f]{16}))?)?$/;
const MAX_LABELS = 500;
// An opening or closing comment or tracked-change tag, as the editor writes
// them (src/utils/annotationTagUtils.ts).
const ANNOTATION_TAG =
	/`?<\/?###(?:\s|%)*(?:comment|review)(?:\s|%)*id:[\s\S]*?###>`?/g;
const MAX_BODY_BYTES = 4096;

class HttpError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

const cleanName = (value, max) =>
	typeof value === 'string'
		? value
				// biome-ignore lint/suspicious/noControlCharactersInRegex: removes them.
				.replace(/[\u0000-\u001f\u007f]/g, ' ')
				.trim()
				.slice(0, max)
		: '';

const sha256 = (content) =>
	crypto.createHash('sha256').update(content).digest('hex');

const createHistory = ({
	dir,
	filesDir,
	docs,
	persistence,
	log,
	idleMs = 30_000,
	maxDelayMs = 5 * 60_000,
	maxVersions = 1000,
}) => {
	fs.mkdirSync(dir, { recursive: true });

	// Changes not saved in a version yet, by project.
	const pending = new Map();
	const tracked = new WeakSet();
	const running = new Map();

	const projectDir = (project) => path.join(dir, project);
	const indexPath = (project) => path.join(projectDir(project), 'index.json');
	const labelsPath = (project) =>
		path.join(projectDir(project), 'labels.json');
	const versionPath = (project, id) =>
		path.join(projectDir(project), `${id}.json`);

	const readJson = (file, fallback) => {
		try {
			return JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch (error) {
			if (error.code === 'ENOENT') return fallback;
			throw error;
		}
	};

	const writeJson = (file, value) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
		fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
		fs.renameSync(temp, file);
	};

	// A document as it is now: the open one, or the stored one.
	const loadDoc = async (docName) => {
		const open = docs.get(docName);
		if (open) return { doc: open, close: () => {} };
		if (!persistence?.provider) return null;
		const doc = await persistence.provider.getYDoc(docName);
		return { doc, close: () => doc.destroy() };
	};

	// The names of those editing through a connection, from what their
	// editors show the others.
	const namesOf = (doc, conn) => {
		const names = [];
		const states = doc.awareness?.getStates();
		for (const clientId of doc.conns.get(conn) ?? []) {
			const name = states?.get(clientId)?.user?.name;
			if (typeof name === 'string' && name.trim()) {
				names.push(name.trim().slice(0, 100));
			}
		}
		return names;
	};

	// Every editor saves the file a document is linked to as the document
	// changes, so only changes to other files say who made them.
	const changesOwnFiles = (doc, collection, transaction) => {
		if (collection !== 'file_sync') return true;
		const files = doc.getMap('files');
		const keys = transaction?.changed?.get(files) ?? new Set();
		return [...keys].some((key) => {
			const entry = files.get(key);
			return entry && !entry.documentId;
		});
	};

	const schedule = (project, change) => {
		const now = Date.now();
		const entry = pending.get(project) ?? {
			since: now,
			authors: new Set(),
			collections: new Set(),
			timer: null,
		};
		for (const name of change.authors) entry.authors.add(name);
		entry.collections.add(change.collection);
		clearTimeout(entry.timer);
		const wait = Math.max(
			0,
			Math.min(idleMs, entry.since + maxDelayMs - now),
		);
		entry.timer = setTimeout(() => void save(project), wait);
		entry.timer.unref?.();
		pending.set(project, entry);
	};

	// Follows a document opened for a project, so that changes made through
	// connections lead to a version.
	const track = (project, collection, doc) => {
		if (!doc || tracked.has(doc)) return;
		tracked.add(doc);
		if (collection === 'chat') return;
		doc.on('update', (_update, origin, _doc, transaction) => {
			// Loading the stored document is not a change.
			if (!doc.conns.has(origin)) return;
			schedule(project, {
				collection,
				authors: changesOwnFiles(doc, collection, transaction)
					? namesOf(doc, origin)
					: [],
			});
		});
	};

	// A change made by the server itself, for an assistant (mcp.js), with who
	// asked for it.
	const record = (project, collection, authors) =>
		schedule(project, { collection, authors });

	// The editor's text; null for a document that holds something else.
	const textOf = (doc) => {
		try {
			return doc.getText('codemirror').toString();
		} catch {
			return null;
		}
	};

	const storeText = (project, text) => {
		const hash = sha256(text);
		const target = path.join(filesDir, project, hash);
		if (!fs.existsSync(target)) {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
			fs.writeFileSync(temp, text);
			fs.renameSync(temp, target);
		}
		const plain = text.replace(ANNOTATION_TAG, '');
		return {
			hash,
			size: Buffer.byteLength(text),
			...(plain === text ? {} : { textHash: sha256(plain) }),
		};
	};

	const changesBetween = (before, after) => {
		const key = (entry) => entry.path;
		const content = (entry) => entry.textHash ?? entry.hash;
		const previous = new Map(
			[...(before?.docs ?? []), ...(before?.files ?? [])].map((entry) => [
				key(entry),
				content(entry),
			]),
		);
		const current = new Map(
			[...after.docs, ...after.files].map((entry) => [
				key(entry),
				content(entry),
			]),
		);
		const changes = [];
		for (const [file, hash] of current) {
			if (!previous.has(file)) changes.push({ path: file, type: 'added' });
			else if (previous.get(file) !== hash) {
				changes.push({ path: file, type: 'modified' });
			}
		}
		for (const file of previous.keys()) {
			if (!current.has(file)) changes.push({ path: file, type: 'deleted' });
		}
		return changes.sort((a, b) => a.path.localeCompare(b.path));
	};

	const snapshot = async (project, entry) => {
		const index = readJson(indexPath(project), []);
		const last = index.length
			? readJson(versionPath(project, index[index.length - 1].id), null)
			: null;
		const lastDocs = new Map((last?.docs ?? []).map((doc) => [doc.id, doc]));

		const metadata = await loadDoc(`${project}-yjs_metadata`);
		if (!metadata) return;
		const documents = metadata.doc.getMap('data').toJSON().documents;
		metadata.close();
		if (!Array.isArray(documents)) return;

		const manifestDoc = await loadDoc(`${project}-file_sync`);
		const manifest = manifestDoc
			? Object.values(manifestDoc.doc.getMap('files').toJSON())
			: [];
		manifestDoc?.close();
		const live = manifest.filter(
			(file) => file && typeof file.path === 'string' && !file.deleted,
		);
		const pathOf = new Map(
			live
				.filter((file) => file.documentId)
				.map((file) => [file.documentId, file.path]),
		);

		const versionDocs = [];
		for (const document of documents) {
			if (!document || typeof document.id !== 'string') continue;
			const collection = `yjs_${document.id}`;
			const known = lastDocs.get(document.id);
			const docPath =
				pathOf.get(document.id) ?? `/${String(document.name ?? document.id)}`;
			if (known && !entry.collections.has(collection)) {
				versionDocs.push({ ...known, path: docPath });
				continue;
			}
			const loaded = await loadDoc(`${project}-${collection}`);
			if (!loaded) continue;
			const text = textOf(loaded.doc);
			loaded.close();
			if (text === null) continue;
			versionDocs.push({
				id: document.id,
				path: docPath,
				...storeText(project, text),
			});
		}
		const docPaths = new Set(versionDocs.map((doc) => doc.path));
		const files = live
			.filter((file) => !file.documentId && !docPaths.has(file.path))
			.map((file) => ({
				path: file.path,
				hash: file.checksum,
				size: file.size,
			}));

		const version = { docs: versionDocs, files };
		const changes = changesBetween(last, version);
		if (last && changes.length === 0) return;

		// Who changed files, when their editors did not say.
		const authors = new Set(entry.authors);
		const changedPaths = new Set(changes.map((change) => change.path));
		for (const file of manifest) {
			const by = file?.updatedBy;
			if (file?.documentId || typeof by !== 'string' || !by) continue;
			if (changedPaths.has(file.path)) authors.add(by.slice(0, 100));
		}

		const time = Date.now();
		const id = `${time}-${crypto.randomBytes(4).toString('hex')}`;
		const summary = { id, time, authors: [...authors].sort(), changes };
		writeJson(versionPath(project, id), { ...summary, ...version });
		index.push(summary);
		// The oldest versions go first, unless they are labelled.
		const labelled = new Set(
			readJson(labelsPath(project), []).map((label) => label.version),
		);
		let extra =
			index.filter((old) => !labelled.has(old.id)).length - maxVersions;
		const kept = index.filter((old) => {
			if (extra <= 0 || labelled.has(old.id)) return true;
			extra--;
			fs.rmSync(versionPath(project, old.id), { force: true });
			return false;
		});
		writeJson(indexPath(project), kept);
		log('version saved');
	};

	// Saves the project's pending changes as a version, one save at a time.
	const save = (project) => {
		const entry = pending.get(project);
		if (!entry) return running.get(project) ?? Promise.resolve();
		pending.delete(project);
		clearTimeout(entry.timer);
		const previous = running.get(project) ?? Promise.resolve();
		const next = previous
			.then(() => snapshot(project, entry))
			.catch((error) => log('could not save a version', error));
		running.set(project, next);
		next.then(() => {
			if (running.get(project) === next) running.delete(project);
		});
		return next;
	};

	// Saves every pending change now, before the server stops.
	const flush = () => Promise.all([...pending.keys()].map(save));

	const list = (project) =>
		readJson(indexPath(project), []).slice().reverse();

	const get = (project, id) =>
		VERSION_ID.test(id) ? readJson(versionPath(project, id), null) : null;

	const labelsOf = (project) => readJson(labelsPath(project), []);

	// Labels a version, or the project as it is now, saving its pending
	// changes first.
	const addLabel = async (project, body) => {
		const name = cleanName(body.name, 100);
		if (!name) throw new HttpError(400, 'invalid_name');
		let version = body.version;
		if (version === undefined || version === null) {
			await save(project);
			version = readJson(indexPath(project), []).at(-1)?.id;
			if (!version) throw new HttpError(409, 'no_version');
		} else if (
			typeof version !== 'string' ||
			!readJson(indexPath(project), []).some((entry) => entry.id === version)
		) {
			throw new HttpError(404, 'unknown_version');
		}
		const labels = labelsOf(project);
		if (labels.length >= MAX_LABELS) {
			throw new HttpError(413, 'too_many_labels');
		}
		const label = {
			id: crypto.randomBytes(8).toString('hex'),
			version,
			name,
			by: cleanName(body.by, 100),
			time: Date.now(),
		};
		writeJson(labelsPath(project), [...labels, label]);
		log('version labelled');
		return { label };
	};

	const removeLabel = (project, labelId) => {
		const labels = labelsOf(project);
		const kept = labels.filter((label) => label.id !== labelId);
		if (kept.length === labels.length) {
			throw new HttpError(404, 'unknown_label');
		}
		writeJson(labelsPath(project), kept);
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

	// The project's history, for a request through an id that opens the
	// project (`found`, from the project links); labels change only through
	// an editing id.
	const route = (url) => {
		const match = ROUTE.exec(url);
		return match
			? {
					id: match[1],
					version: match[2],
					labels: Boolean(match[3]),
					label: match[4],
				}
			: null;
	};

	const handle = async (req, res, request, found) => {
		const reply = (status, body) => {
			res.writeHead(status, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			});
			res.end(body === undefined ? '' : JSON.stringify(body));
		};
		const allowed = request.label
			? 'DELETE'
			: request.labels
				? 'POST'
				: 'GET';
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Methods': allowed,
				'Access-Control-Allow-Headers': 'Content-Type',
				'Access-Control-Max-Age': '86400',
			});
			res.end();
			return;
		}
		if (req.method !== allowed) {
			req.resume();
			res.setHeader('Allow', allowed);
			reply(405, { error: 'method_not_allowed' });
			return;
		}
		try {
			if (req.method === 'GET') {
				req.resume();
				const body = request.version
					? get(found.project, request.version)
					: {
							versions: list(found.project),
							labels: labelsOf(found.project),
						};
				if (!body) throw new HttpError(404, 'unknown_version');
				reply(200, body);
				return;
			}
			if (found.access !== 'edit') {
				req.resume();
				throw new HttpError(403, 'read_only');
			}
			if (req.method === 'DELETE') {
				req.resume();
				removeLabel(found.project, request.label);
				reply(204);
				return;
			}
			reply(200, await addLabel(found.project, await readBody(req)));
		} catch (error) {
			if (error instanceof HttpError) {
				reply(error.status, { error: error.code });
				return;
			}
			log('history request failed', error);
			reply(500, { error: 'server_error' });
		}
	};

	return { track, record, flush, list, get, route, handle };
};

module.exports = { createHistory };
