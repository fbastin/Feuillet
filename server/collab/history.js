// server/collab/history.js
// Versions of each project, as on Overleaf: a short while after its
// documents or files change, the server saves a version listing the text of
// every document and the checksum of every other file, with the names of
// those who made the changes. Texts are stored with the project's files, by
// SHA-256, so a text that did not change is not stored again.
//
//   GET /history/<id>              -> {versions}, newest first: {id, time,
//                                     authors, changes: [{path, type}]}
//   GET /history/<id>/<version>    -> {id, time, authors, docs: [{id, path,
//                                     hash, size}], files: [{path, hash,
//                                     size}]}
//
// <id> is any id that opens the project (an editing id or a read-only link).
// Contents come from /files/<id>/<hash>.
//
// HISTORY_DIR keeps, per project, index.json (the list) and one file per
// version.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION_ID = /^[0-9]{13}-[0-9a-f]{8}$/;

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
		return { hash, size: Buffer.byteLength(text) };
	};

	const changesBetween = (before, after) => {
		const key = (entry) => entry.path;
		const previous = new Map(
			[...(before?.docs ?? []), ...(before?.files ?? [])].map((entry) => [
				key(entry),
				entry.hash,
			]),
		);
		const current = new Map(
			[...after.docs, ...after.files].map((entry) => [key(entry), entry.hash]),
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
		const dropped = index.splice(0, Math.max(0, index.length - maxVersions));
		for (const old of dropped) {
			fs.rmSync(versionPath(project, old.id), { force: true });
		}
		writeJson(indexPath(project), index);
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

	return { track, flush, list, get };
};

module.exports = { createHistory };
