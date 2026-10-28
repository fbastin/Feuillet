// server/collab/review.js
// Reviewers, as on Overleaf: they comment and suggest changes, which editors
// accept or reject.
//
// Comments and tracked changes live in a document's text as tags, as the
// editor writes them (src/utils/annotationTagUtils.ts), and a tracked change
// keeps, base64-encoded, the text it replaces:
//
//   `<### review id: X, user: U, time: T, original: 'b64', ... ###>`new text`</### review id: X ###>`
//
// A document's base text is its text with every tracked change rejected and
// without any tag. Whatever a reviewer sends to a document must leave its
// base text as it was, and change nothing in it but its text; otherwise the
// server drops it and closes the connection.

const Y = require('yjs');
const decoding = require('lib0/decoding');

const TEXT = 'codemirror';
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

// Same patterns as the editor's.
const SEPARATORS = '(?:\\s|%)*';
const openTagRegex = (kind) =>
	new RegExp(`<###${SEPARATORS}${kind}${SEPARATORS}id:${SEPARATORS}([\\w-]+)`, 'g');
const closeTagRegex = (kind, id) =>
	new RegExp(
		`<\\/###${SEPARATORS}${kind}${SEPARATORS}id:${SEPARATORS}${id}${SEPARATORS}###>`,
		'g',
	);
const ANY_TAG = new RegExp(
	['comment', 'review']
		.flatMap((kind) => [
			`\`?<###${SEPARATORS}${kind}${SEPARATORS}id:[\\s\\S]*?###>\`?`,
			`\`?<\\/###${SEPARATORS}${kind}${SEPARATORS}id:${SEPARATORS}[\\w-]+${SEPARATORS}###>\`?`,
		])
		.join('|'),
	'g',
);

// The tracked changes of a text, as the editor finds them: each opening tag
// with the next closing tag of the same id, backticks included.
const reviewsOf = (text) => {
	const found = [];
	const open = openTagRegex('review');
	let searchStart = 0;
	while (searchStart < text.length) {
		open.lastIndex = searchStart;
		const match = open.exec(text);
		if (!match) break;
		const start = match.index;
		const id = match[1];
		const openEnd = text.indexOf('###>', start);
		if (openEnd === -1) {
			searchStart = start + 1;
			continue;
		}
		const close = closeTagRegex('review', id);
		close.lastIndex = openEnd + 4;
		const closeMatch = close.exec(text);
		if (!closeMatch) {
			searchStart = openEnd + 4;
			continue;
		}
		open.lastIndex = openEnd + 4;
		const next = open.exec(text);
		if (next && next[1] === id && next.index < closeMatch.index) {
			searchStart = openEnd + 4;
			continue;
		}
		const backtickBefore = start > 0 && text[start - 1] === '`';
		const backtickAfter = text[openEnd + 4] === '`';
		const closeEnd = closeMatch.index + closeMatch[0].length;
		const content = text
			.substring(start, openEnd + 4)
			.replace(/\n\s*%\s*/g, ' ');
		const original = /original:\s*'([^']*)'/.exec(content)?.[1] ?? '';
		found.push({
			from: backtickBefore ? start - 1 : start,
			to: backtickAfter && text[closeEnd] === '`' ? closeEnd + 1 : closeEnd,
			original: Buffer.from(original.trim(), 'base64').toString('utf8'),
		});
		searchStart = openEnd + 4;
	}
	return found;
};

/** The text with every tracked change rejected and without any tag. */
const baseText = (text) => {
	if (!text.includes('<###') && !text.includes('</###')) return text;
	let base = '';
	let pos = 0;
	// A tracked change inside another goes with it.
	for (const review of reviewsOf(text)) {
		if (review.from < pos) continue;
		base += text.slice(pos, review.from) + review.original;
		pos = review.to;
	}
	return (base + text.slice(pos)).replace(ANY_TAG, '');
};

const createReviewGuard = ({ docs, persistence, log }) => {
	// Per document a reviewer changes, a copy kept in step with it, where
	// their changes are tried first.
	const probes = new Map();

	const probeFor = (docName) => {
		const doc = docs.get(docName);
		if (!doc) return Promise.resolve(null);
		const known = probes.get(docName);
		if (known?.doc === doc) return known.ready;
		known?.stop();

		const probe = new Y.Doc();
		probe.getText(TEXT);
		const follow = (update) => Y.applyUpdate(probe, update);
		let stopped = false;
		const entry = {
			doc,
			stop: () => {
				stopped = true;
				doc.off('update', follow);
				probe.destroy();
				if (probes.get(docName) === entry) probes.delete(docName);
			},
		};
		entry.ready = (async () => {
			// The document may still be loading from storage, and the
			// reviewer's editor sends at once whatever it seems to lack.
			const stored = persistence?.provider
				? await persistence.provider.getYDoc(docName)
				: null;
			if (stored) {
				Y.applyUpdate(probe, Y.encodeStateAsUpdate(stored));
				stored.destroy();
			}
			if (stopped) return null;
			Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
			doc.on('update', follow);
			return probe;
		})();
		doc.on('destroy', entry.stop);
		probes.set(docName, entry);
		return entry.ready;
	};

	// Whether a reviewer's update to a document may be applied.
	const allows = async (docName, update) => {
		const probe = await probeFor(docName);
		if (!probe) return false;
		const text = probe.getText(TEXT);
		const before = text.toString();
		let onlyText = true;
		const watch = (transaction) => {
			for (const type of transaction.changed.keys()) {
				if (type !== text) onlyText = false;
			}
		};
		probe.on('afterTransaction', watch);
		try {
			Y.applyUpdate(probe, update);
		} catch {
			onlyText = false;
		} finally {
			probe.off('afterTransaction', watch);
		}
		// Waiting for something the server does not have, it would apply
		// later, unchecked.
		const complete = !probe.store.pendingStructs && !probe.store.pendingDs;
		const after = text.toString();
		const allowed =
			onlyText &&
			complete &&
			(before === after || baseText(before) === baseText(after));
		// The copy now holds the refused change: start again from the document.
		if (!allowed) probes.get(docName)?.stop();
		return allowed;
	};

	const passes = async (docName, bytes) => {
		try {
			const decoder = decoding.createDecoder(bytes);
			const type = decoding.readVarUint(decoder);
			if (type === MESSAGE_AWARENESS) return true;
			if (type !== MESSAGE_SYNC) return false;
			const step = decoding.readVarUint(decoder);
			if (step === SYNC_STEP_1) return true;
			if (step !== SYNC_STEP_2 && step !== SYNC_UPDATE) return false;
			return await allows(docName, decoding.readVarUint8Array(decoder));
		} catch {
			return false;
		}
	};

	// Lets through a reviewer's connection to a document only what `allows`,
	// in the order it was sent; the first refusal closes it.
	const guard = (conn, docName) => {
		const on = conn.on.bind(conn);
		conn.on = (event, listener) => {
			if (event !== 'message') return on(event, listener);
			let queue = Promise.resolve();
			let refused = false;
			return on('message', (data, ...rest) => {
				const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
				queue = queue.then(async () => {
					if (refused) return;
					if (await passes(docName, bytes)) {
						listener(data, ...rest);
						return;
					}
					refused = true;
					log('reviewer change refused');
					conn.close(4422, 'Untracked change');
				});
			});
		};
	};

	return { allows, guard };
};

module.exports = { baseText, createReviewGuard };
