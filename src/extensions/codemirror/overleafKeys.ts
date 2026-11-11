// src/extensions/codemirror/overleafKeys.ts
// Overleaf's other editor keys: Ctrl+U and Ctrl+Shift+U put the selection
// (or the word at the cursor) in upper or lower case, Ctrl+Shift+L goes to a
// line, Ctrl+J shows or hides the review panel and Ctrl+Shift+A turns track
// changes on or off. They come before CodeMirror's own (Ctrl+U « undo
// selection », Ctrl+Shift+L « select all matches »). Ctrl+S, which saves and
// compiles, and Ctrl+Shift+C, which comments, are in useEditorView.
import { gotoLine } from '@codemirror/search';
import { EditorSelection, type StateCommand } from '@codemirror/state';
import type { EditorView, KeyBinding } from '@codemirror/view';

/** Asks the review panel to show or hide (ReviewContext listens). */
export const TOGGLE_REVIEW_PANEL = 'toggle-review-panel';
/** Asks for one's track changes to be turned on or off. */
export const TOGGLE_TRACK_CHANGES = 'toggle-track-changes';

const changeCase =
	(transform: (text: string) => string): StateCommand =>
	({ state, dispatch }) => {
		if (state.readOnly) return false;
		let changed = false;
		const spec = state.changeByRange((range) => {
			const target = range.empty ? (state.wordAt(range.head) ?? range) : range;
			const text = state.sliceDoc(target.from, target.to);
			const next = transform(text);
			if (next === text) return { range };
			changed = true;
			const end = target.from + next.length;
			return {
				changes: { from: target.from, to: target.to, insert: next },
				// The cursor where it was; a selection over the new text, in
				// the same direction.
				range: range.empty
					? EditorSelection.cursor(Math.min(range.head, end))
					: range.anchor <= range.head
						? EditorSelection.range(target.from, end)
						: EditorSelection.range(end, target.from),
			};
		});
		if (!changed) return false;
		dispatch(
			state.update(spec, { scrollIntoView: true, userEvent: 'input.case' }),
		);
		return true;
	};

export const toUpperCase = changeCase((text) => text.toUpperCase());
export const toLowerCase = changeCase((text) => text.toLowerCase());

const announce = (name: string) => () => {
	document.dispatchEvent(new CustomEvent(name));
	return true;
};

export function overleafEditorKeys(options: {
	reviews: boolean;
}): KeyBinding[] {
	return [
		{ key: 'Mod-u', run: toUpperCase, preventDefault: true },
		{ key: 'Mod-Shift-u', run: toLowerCase, preventDefault: true },
		{ key: 'Mod-Shift-l', run: gotoLine, preventDefault: true },
		...(options.reviews
			? [
					{
						key: 'Mod-j',
						run: announce(TOGGLE_REVIEW_PANEL),
						preventDefault: true,
					},
					{
						// Asked when pressed: whether the file can be edited is
						// known after the keys are set.
						key: 'Mod-Shift-a',
						run: (view: EditorView) =>
							!view.state.readOnly && announce(TOGGLE_TRACK_CHANGES)(),
						preventDefault: true,
					},
				]
			: []),
	];
}
