// src/extensions/codemirror/toolbar/helpers.ts
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

// Both act on every selection when there are several (multiple cursors).

export const wrapSelection = (
	view: EditorView,
	before: string,
	after: string,
): boolean => {
	view.dispatch(
		view.state.changeByRange((range) => {
			const selectedText = view.state.sliceDoc(range.from, range.to);
			const start = range.from + before.length;
			return {
				changes: {
					from: range.from,
					to: range.to,
					insert: `${before}${selectedText}${after}`,
				},
				range: EditorSelection.range(start, start + selectedText.length),
			};
		}),
	);

	view.focus();
	return true;
};

export const insertText = (
	view: EditorView,
	text: string,
	cursorOffset: number = 0,
): boolean => {
	view.dispatch(
		view.state.changeByRange((range) => ({
			changes: { from: range.from, to: range.to, insert: text },
			range: EditorSelection.cursor(range.from + text.length + cursorOffset),
		})),
	);

	view.focus();
	return true;
};
