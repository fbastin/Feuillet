import { closeBrackets } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
	insertsAlone,
	latexCloseBrackets,
} from '@src/extensions/codemirror/latexCloseBrackets';

let view: EditorView | null = null;
afterEach(() => {
	view?.destroy();
	view = null;
});

// Types as the browser does: each input handler in turn, else the text.
const typeIn = (keys: string, autoClose = true): string => {
	view = new EditorView({
		state: EditorState.create({
			extensions: [latexCloseBrackets, autoClose ? closeBrackets() : []],
		}),
		parent: document.body,
	});
	const v = view;
	for (const key of keys) {
		const { from, to } = v.state.selection.main;
		const handled = v.state
			.facet(EditorView.inputHandler)
			.some((handler) =>
				handler(v, from, to, key, () => v.state.update({ changes: { from, to, insert: key } })),
			);
		if (!handled)
			v.dispatch({
				changes: { from, to, insert: key },
				selection: { anchor: from + key.length },
			});
	}
	return v.state.doc.toString();
};

describe('auto-closing in LaTeX', () => {
	it('pairs $, typed over at the end of the formula', () => {
		expect(typeIn('$')).toBe('$$');
		expect(typeIn('$x$ ok')).toBe('$x$ ok');
	});

	it('pairs { and [, not a plain (', () => {
		expect(typeIn('\\frac{a')).toBe('\\frac{a}');
		expect(typeIn('\\sqrt[3')).toBe('\\sqrt[3]');
		expect(typeIn('f(x')).toBe('f(x');
	});

	it('nothing after a backslash, two backslashes being a line break', () => {
		expect(typeIn('\\$5')).toBe('\\$5');
		expect(typeIn('\\{a')).toBe('\\{a');
		expect(typeIn('\\[x')).toBe('\\[x');
		expect(typeIn('\\\\[2pt')).toBe('\\\\[2pt]');
	});

	it('quotes are left alone', () => {
		expect(typeIn("'a")).toBe("'a");
		expect(typeIn('"a')).toBe('"a');
	});

	it('pairs nothing when auto-closing is off', () => {
		expect(typeIn('$x{', false)).toBe('$x{');
	});
});

describe('a $ that goes in alone', () => {
	it('closes an open formula, or opens one before a command', () => {
		expect(insertsAlone('$', 'cost $a + ', '')).toBe(true);
		expect(insertsAlone('$', 'and ', '\\alpha')).toBe(true);
		expect(insertsAlone('$', 'and ', ' rest')).toBe(false);
		// An escaped \$ before does not open a formula.
		expect(insertsAlone('$', 'cost \\$5 and ', '')).toBe(false);
	});
});
