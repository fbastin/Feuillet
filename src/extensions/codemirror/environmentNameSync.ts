// src/extensions/codemirror/environmentNameSync.ts
// Renaming an environment renames both ends: typing in the name of
// \begin{itemize} changes its \end{itemize} too, and the other way round,
// as code editors pair HTML tags. Only for one's own typing, only when the
// name's \begin and \end are balanced in the file (else which \end goes
// with which \begin is a guess), never in comments. Not while changes are
// tracked, nor in a name holding a review or comment tag: the tags would be
// copied, or each end tracked apart.
import { EditorState, type Extension, Transaction } from '@codemirror/state';

const COMMAND = /\\(begin|end)\s*\{([^{}\n]*)\}/g;
const MAX_LENGTH = 2_000_000;

interface Command {
	kind: 'begin' | 'end';
	name: string;
	/** The name's place, inside the braces. */
	from: number;
	to: number;
}

// Whether a % before `index` on its line starts a comment (\% does not).
const commented = (text: string, index: number): boolean => {
	const lineStart = text.lastIndexOf('\n', index - 1) + 1;
	for (let i = lineStart; i < index; i++) {
		if (text[i] !== '%') continue;
		let slashes = 0;
		for (let j = i - 1; j >= lineStart && text[j] === '\\'; j--) slashes++;
		if (slashes % 2 === 0) return true;
	}
	return false;
};

const commandsOf = (text: string, name?: string): Command[] => {
	const found: Command[] = [];
	for (const match of text.matchAll(COMMAND)) {
		const index = match.index ?? 0;
		if (name !== undefined && match[2] !== name) continue;
		if (commented(text, index)) continue;
		const from = index + match[0].length - 1 - match[2].length;
		found.push({
			kind: match[1] as 'begin' | 'end',
			name: match[2],
			from,
			to: from + match[2].length,
		});
	}
	return found;
};

/** The \begin or \end whose name holds [from, to], or null. */
export const commandAt = (
	text: string,
	from: number,
	to: number,
): Command | null => {
	const lineStart = text.lastIndexOf('\n', from - 1) + 1;
	const lineEnd = text.indexOf('\n', to);
	const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
	for (const command of commandsOf(line)) {
		const start = lineStart + command.from;
		const end = lineStart + command.to;
		if (start <= from && to <= end) {
			if (commented(text, start)) return null;
			return { ...command, from: start, to: end };
		}
	}
	return null;
};

/** The other end of `command` (same name, nesting counted), or null. */
export const partnerOf = (text: string, command: Command): Command | null => {
	const all = commandsOf(text, command.name);
	const begins = all.filter((entry) => entry.kind === 'begin').length;
	if (begins * 2 !== all.length) return null;
	const index = all.findIndex((entry) => entry.from === command.from);
	if (index < 0) return null;
	const step = command.kind === 'begin' ? 1 : -1;
	let depth = 0;
	for (let i = index + step; i >= 0 && i < all.length; i += step) {
		if (all[i].kind === command.kind) depth++;
		else if (depth === 0) return all[i];
		else depth--;
	}
	return null;
};

/**
 * For an edit replacing [from, to] of `text` by `insert`: where the other
 * end's name is, in `text`, and the name to give it; or null.
 */
export const mirrorEdit = (
	text: string,
	from: number,
	to: number,
	insert: string,
): { from: number; to: number; name: string } | null => {
	if (text.length > MAX_LENGTH || /[{}\n\\%]|<###|###>/.test(insert))
		return null;
	const command = commandAt(text, from, to);
	if (!command || /<###|###>|`/.test(command.name)) return null;
	const name =
		text.slice(command.from, from) + insert + text.slice(to, command.to);
	if (name === command.name) return null;
	const partner = partnerOf(text, command);
	if (!partner) return null;
	return { from: partner.from, to: partner.to, name };
};

export const environmentNameSync = (
	paused: (state: EditorState) => boolean = () => false,
): Extension =>
	EditorState.transactionFilter.of((tr) => {
		if (
			!tr.docChanged ||
			!(tr.isUserEvent('input') || tr.isUserEvent('delete')) ||
			tr.annotation(Transaction.remote) ||
			paused(tr.startState)
		)
			return tr;
		let edits = 0;
		let edit: { from: number; to: number; insert: string } | null = null;
		tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
			edits++;
			edit = { from: fromA, to: toA, insert: inserted.toString() };
		});
		if (edits !== 1 || !edit) return tr;
		const { from, to, insert } = edit as {
			from: number;
			to: number;
			insert: string;
		};
		const mirror = mirrorEdit(tr.startState.doc.toString(), from, to, insert);
		if (!mirror) return tr;
		return [
			tr,
			{
				changes: {
					from: tr.changes.mapPos(mirror.from, 1),
					to: tr.changes.mapPos(mirror.to, -1),
					insert: mirror.name,
				},
				sequential: true,
			},
		];
	});
