// server/collab/copy.js
// Copies of projects, as Overleaf's "Make a copy": the project's settings,
// documents, file list and files, under a new id, with their comments and
// tracked changes; not its chat, its versions nor its GitHub link.

const fs = require('node:fs');
const path = require('node:path');
const Y = require('yjs');

const HASH = /^[0-9a-f]{64}$/;

const createProjectCopier = ({ docs, persistence, getYDoc, filesDir }) => {
	// A document as the server has it: stored, and open if it is.
	const load = async (docName) => {
		const doc = new Y.Doc();
		if (persistence?.provider) {
			const stored = await persistence.provider.getYDoc(docName);
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(stored));
			stored.destroy();
		}
		const open = docs.get(docName);
		if (open) Y.applyUpdate(doc, Y.encodeStateAsUpdate(open));
		return doc;
	};

	const save = async (docName, doc) => {
		const update = Y.encodeStateAsUpdate(doc);
		doc.destroy();
		if (persistence?.provider) {
			await persistence.provider.storeUpdate(docName, update);
		} else {
			Y.applyUpdate(getYDoc(docName), update);
		}
	};

	// Whether there was a project to copy.
	return async (from, to, { name = '' } = {}) => {
		const metadata = await load(`${from}-yjs_metadata`);
		const data = metadata.getMap('data');
		const documents = data.get('documents');
		const settings = data.get('projectMetadata');
		if (!Array.isArray(documents) && !settings) {
			metadata.destroy();
			return false;
		}
		metadata.transact(() => {
			// The copy is not linked to the project's repository.
			data.delete('gitRemote');
			if (name && settings && typeof settings === 'object') {
				data.set('projectMetadata', { ...settings, name });
			}
		});
		await save(`${to}-yjs_metadata`, metadata);

		for (const document of Array.isArray(documents) ? documents : []) {
			const id = document?.id;
			if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
				continue;
			}
			await save(`${to}-yjs_${id}`, await load(`${from}-yjs_${id}`));
		}

		const manifest = await load(`${from}-file_sync`);
		const hashes = new Set(
			Object.values(manifest.getMap('files').toJSON())
				.filter((file) => file && !file.deleted && HASH.test(file.checksum))
				.map((file) => file.checksum),
		);
		await save(`${to}-file_sync`, manifest);

		// Contents are named by their hash and never change, so the copy may
		// share them.
		const source = path.join(filesDir, from);
		const target = path.join(filesDir, to);
		fs.mkdirSync(target, { recursive: true });
		for (const hash of hashes) {
			const file = path.join(source, hash);
			if (!fs.existsSync(file)) continue;
			try {
				fs.linkSync(file, path.join(target, hash));
			} catch {
				fs.copyFileSync(file, path.join(target, hash));
			}
		}
		return true;
	};
};

module.exports = { createProjectCopier };
