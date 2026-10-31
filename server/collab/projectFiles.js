// server/collab/projectFiles.js
// A project's files as the server holds them, for the assistants that work
// on projects through mcp.js:
//
//  - `<project>-file_sync`: the shared manifest, a Y.Map 'files' from path
//    to {path, checksum, size, lastModified, documentId?, deleted,
//    updatedBy} (src/utils/serverFileSyncUtils.ts); contents are stored in
//    FILES_DIR/<project>/<checksum>;
//  - `<project>-yjs_<documentId>`: the text of a file opened in the editor,
//    a Y.Text 'codemirror', which is newer than the file's stored contents;
//  - `<project>-yjs_metadata`: a Y.Map 'data' with the project's settings
//    (projectMetadata: main file, compiler).
//
// Changes go to the open document when collaborators have it open, so that
// they see them at once, and to the stored one otherwise.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Y = require('yjs');

const TEXT = 'codemirror';
const HASH = /^[0-9a-f]{64}$/;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
// Where a change made by an assistant comes from, in Yjs.
const ORIGIN = 'assistant';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Contents that read as UTF-8 text without NUL bytes.
const textOf = (bytes) => {
	if (bytes.length > MAX_TEXT_BYTES) return null;
	if (bytes.subarray(0, 8192).includes(0)) return null;
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
};

const createProjectFiles = ({ docs, persistence, getYDoc, filesDir }) => {
	const stored = persistence?.provider ?? null;

	// A copy of a document as it is now, open or stored.
	const snapshot = async (docName) => {
		const doc = new Y.Doc();
		const open = docs.get(docName);
		if (open) {
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(open));
			return doc;
		}
		if (stored) {
			const kept = await stored.getYDoc(docName);
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(kept));
			kept.destroy();
		}
		return doc;
	};

	// Changes a document where collaborators see it: the open one, or the
	// stored one, and the open one too if it opened meanwhile.
	const change = async (docName, apply) => {
		const open = docs.get(docName);
		if (open) {
			let result;
			open.transact(() => {
				result = apply(open);
			}, ORIGIN);
			return result;
		}
		const doc = await snapshot(docName);
		const before = Y.encodeStateVector(doc);
		let result;
		doc.transact(() => {
			result = apply(doc);
		});
		const update = Y.encodeStateAsUpdate(doc, before);
		doc.destroy();
		if (stored) await stored.storeUpdate(docName, update);
		const opened = docs.get(docName);
		if (opened) Y.applyUpdate(opened, update, ORIGIN);
		else if (!stored) Y.applyUpdate(getYDoc(docName), update, ORIGIN);
		return result;
	};

	/** The project's files that are not deleted, by path. */
	const manifest = async (project) => {
		const doc = await snapshot(`${project}-file_sync`);
		const entries = Object.values(doc.getMap('files').toJSON());
		doc.destroy();
		return new Map(
			entries
				.filter(
					(entry) =>
						entry &&
						typeof entry.path === 'string' &&
						entry.path.startsWith('/') &&
						!entry.deleted,
				)
				.map((entry) => [entry.path, entry]),
		);
	};

	/** The project's settings: name, main file, compiler options. */
	const settings = async (project) => {
		const doc = await snapshot(`${project}-yjs_metadata`);
		const data = doc.getMap('data').toJSON();
		doc.destroy();
		return {
			metadata:
				data.projectMetadata && typeof data.projectMetadata === 'object'
					? data.projectMetadata
					: {},
			documents: Array.isArray(data.documents) ? data.documents : [],
		};
	};

	const storedBytes = (project, checksum) => {
		if (!HASH.test(String(checksum))) return null;
		try {
			return fs.readFileSync(path.join(filesDir, project, checksum));
		} catch {
			return null;
		}
	};

	/**
	 * A file's contents: {text, document} for text, with its comments and
	 * tracked changes, `document` when it is the editor's text; {bytes}
	 * otherwise; null when the server does not have them.
	 */
	const read = async (project, entry) => {
		if (entry.documentId) {
			const doc = await snapshot(`${project}-yjs_${entry.documentId}`);
			const text = doc.getText(TEXT).toString();
			const empty = doc.store.clients.size === 0;
			doc.destroy();
			// A document nobody opened on the server yet: its file.
			if (!empty) return { text, document: true };
		}
		const bytes = storedBytes(project, entry.checksum);
		if (!bytes) return null;
		const text = textOf(bytes);
		if (text === null) return { bytes };
		// Linked to a document the server has no text of yet: only the
		// editor that made it can change it.
		return { text, document: false, unsaved: Boolean(entry.documentId) };
	};

	const storeBytes = (project, bytes) => {
		const checksum = sha256(bytes);
		const target = path.join(filesDir, project, checksum);
		if (!fs.existsSync(target)) {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
			fs.writeFileSync(temp, bytes);
			fs.renameSync(temp, target);
		}
		return checksum;
	};

	/**
	 * Changes the text of a file opened in the editor: `apply(text)` gets the
	 * Y.Text, and changes it in place.
	 */
	const changeDocument = (project, documentId, apply) =>
		change(`${project}-yjs_${documentId}`, (doc) => apply(doc.getText(TEXT)));

	/**
	 * Stores new contents for a file that is not open in the editor, or a new
	 * file; collaborators' editors download it.
	 */
	const writeFile = async (project, filePath, text, updatedBy) => {
		const bytes = Buffer.from(text, 'utf8');
		const checksum = storeBytes(project, bytes);
		await change(`${project}-file_sync`, (doc) => {
			const files = doc.getMap('files');
			const current = files.get(filePath);
			files.set(filePath, {
				path: filePath,
				checksum,
				size: bytes.length,
				// Newer than any copy, so that every editor takes it.
				lastModified: Math.max(Date.now(), (current?.lastModified ?? 0) + 1),
				deleted: false,
				updatedBy,
			});
		});
		return checksum;
	};

	return { manifest, settings, read, changeDocument, writeFile, storedBytes };
};

module.exports = { createProjectFiles, textOf, ORIGIN };
