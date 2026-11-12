// src/extensions/codemirror/latexCloseBrackets.ts
// Auto-closing in LaTeX, as on Overleaf: $ pairs ($|$) as { and [ do; a
// plain ( does not (prose has unpaired ones); and nothing pairs after a
// backslash: \$, \{, \[ and \( are escapes or math delimiters, not
// brackets. A $ closing an inline formula, or opening one right before a
// command ($\alpha), is not doubled either. These rules only keep a pair
// from being inserted: whether auto-closing is on stays the setting's.
import { EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const OPENERS = new Set(['$', '{', '[', '(']);

/**
 * Whether `char`, typed between `before` and `after` (the line's text on
 * each side of the cursor), goes in alone rather than with its closer.
 */
export function insertsAlone(
	char: string,
	before: string,
	after: string,
): boolean {
	const slashes = /\\*$/.exec(before)?.[0].length ?? 0;
	if (slashes % 2 === 1) return true;
	if (char === '(') return true;
	if (char === '$') {
		// Typed over the $ auto-closing put: closeBrackets' to decide.
		if (after.startsWith('$')) return false;
		if (after[0] === '\\' && /[a-zA-Z@]/.test(after[1] ?? '')) return true;
		// An odd number of $ before it on the line: it closes a formula.
		const dollars =
			before.replace(/\\\\/g, '').match(/(?<!\\)\$/g)?.length ?? 0;
		if (dollars % 2 === 1) return true;
	}
	return false;
}

export const latexCloseBrackets: Extension = [
	// $ counts as a bracket; quotes do not (LaTeX writes ``…'').
	Prec.high(
		EditorState.languageData.of(() => [
			{
				closeBrackets: {
					brackets: ['$', '{', '[', '('],
					before: ')]}:;>$',
				},
			},
		]),
	),
	Prec.high(
		EditorView.inputHandler.of((view, from, to, text) => {
			if (!OPENERS.has(text) || from !== to) return false;
			const { state } = view;
			if (state.readOnly || state.selection.ranges.length !== 1) return false;
			const line = state.doc.lineAt(from);
			const before = state.sliceDoc(line.from, from);
			const after = state.sliceDoc(from, Math.min(line.to, from + 2));
			if (!insertsAlone(text, before, after)) return false;
			view.dispatch({
				changes: { from, insert: text },
				selection: { anchor: from + text.length },
				userEvent: 'input.type',
				scrollIntoView: true,
			});
			return true;
		}),
	),
];
