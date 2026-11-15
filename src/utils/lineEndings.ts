// src/utils/lineEndings.ts
// Shared texts keep their lines with \n alone. CodeMirror counts a line
// break as one character, \r\n too, while a Y.Text counts two: with \r in
// the shared text, y-codemirror put each change made in the editor as many
// characters too early as there were \r before it (typing « XYZ » after
// « Two » on line 6 of a CRLF file gave « title =XYZ {Two} »). So text
// written into a shared document is written with \n, and a \r that comes
// into one (a file with CRLF, a paste, an older client) is taken out.
import type * as Y from 'yjs';

/** \r\n and a lone \r as \n. */
export const toLineFeeds = (text: string): string =>
	text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;

/** The origin of the change taking \r out: not one to undo. */
export const LINE_ENDINGS_ORIGIN = Symbol('feuillet-line-endings');

/** Takes the \r out of a shared text; whether there was any. */
export function normalizeLineEndings(ytext: Y.Text): boolean {
	const text = ytext.toString();
	if (!text.includes('\r')) return false;
	const doc = ytext.doc;
	const change = () => {
		// From the end, each run of \r at once, so that the indices before
		// stay where they are.
		let end = text.length;
		while (end > 0) {
			const at = text.lastIndexOf('\r', end - 1);
			if (at < 0) break;
			let start = at;
			while (start > 0 && text[start - 1] === '\r') start--;
			// \r\r\n: one line break for the \r before the \n, as each \r
			// alone is one.
			const count = at - start + 1;
			const breaks = text[at + 1] === '\n' ? count - 1 : count;
			ytext.delete(start, count);
			if (breaks > 0) ytext.insert(start, '\n'.repeat(breaks));
			end = start;
		}
	};
	if (doc) doc.transact(change, LINE_ENDINGS_ORIGIN);
	else change();
	return true;
}

/**
 * Keeps a shared text with \n alone: now, and whenever a \r comes into it,
 * once the change that brought it is done. Gives the function that stops.
 */
export function keepLineFeeds(ytext: Y.Text): () => void {
	let scheduled = false;
	let stopped = false;
	const run = () => {
		scheduled = false;
		if (stopped || ytext.doc?.isDestroyed) return;
		normalizeLineEndings(ytext);
	};
	const observer = (event: Y.YTextEvent) => {
		if (scheduled) return;
		const brought = event.delta.some(
			(op) => typeof op.insert === 'string' && op.insert.includes('\r'),
		);
		if (!brought) return;
		scheduled = true;
		queueMicrotask(run);
	};
	ytext.observe(observer);
	run();
	return () => {
		stopped = true;
		ytext.unobserve(observer);
	};
}
