// src/extensions/codemirror/multipleSelections.ts
// Several cursors and selections at once, as on Overleaf: Ctrl+Alt+→/←
// add the next or previous occurrence of the selection, Ctrl+Alt+↑/↓ a
// cursor on the line above or below, Ctrl+click (⌘-click) a cursor where it
// clicks — except on a link, which it still follows —, Alt+drag selects a
// rectangle, and Escape keeps only the main one. What is typed goes to every
// cursor. Ctrl+D (⌘D) deletes the line, as on Overleaf.
import { deleteLine } from '@codemirror/commands';
import { SearchCursor, selectNextOccurrence } from '@codemirror/search';
import {
	EditorSelection,
	EditorState,
	type Extension,
	Prec,
	type StateCommand,
} from '@codemirror/state';
import {
	crosshairCursor,
	drawSelection,
	EditorView,
	type KeyBinding,
	rectangularSelection,
} from '@codemirror/view';

const onMac =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** A Ctrl+click (⌘ on Mac) adds a cursor, not one on a link to follow. */
export const addsSelectionRange = (event: MouseEvent): boolean =>
	(onMac ? event.metaKey : event.ctrlKey) &&
	!(event.target instanceof Element && event.target.closest('.cm-link-hover'));

export function multipleSelections(): Extension {
	return [
		EditorState.allowMultipleSelections.of(true),
		// The other cursors and selections are drawn, as the browser shows one.
		drawSelection(),
		rectangularSelection(),
		crosshairCursor(),
		EditorView.clickAddsSelectionRange.of(addsSelectionRange),
		// Drawn in Feuillet's colours (the browser's selection colour until
		// now); a highlight theme that has its own keeps them.
		Prec.lowest(
			EditorView.theme({
				'.cm-cursor, .cm-dropCursor': {
					borderLeftColor: 'var(--cm-color-editor-text)',
				},
				'.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
					{ background: 'var(--pico-text-selection-color)' },
			}),
		),
	];
}

/**
 * Adds the previous occurrence of the selection (the one before the first
 * selected, else the last of the document), as selectNextOccurrence adds
 * the next; with an empty cursor, selects the word first.
 */
export const selectPreviousOccurrence: StateCommand = ({ state, dispatch }) => {
	const { ranges, main } = state.selection;
	if (ranges.some((range) => range.empty))
		return selectNextOccurrence({ state, dispatch });
	const text = state.sliceDoc(ranges[0].from, ranges[0].to);
	if (ranges.some((range) => state.sliceDoc(range.from, range.to) !== text))
		return false;
	// A whole word selected matches whole words only.
	const word = state.wordAt(main.head);
	const fullWord = !!word && word.from === main.from && word.to === main.to;
	const free: Array<{ from: number; to: number }> = [];
	const cursor = new SearchCursor(state.doc, text);
	while (!cursor.next().done) {
		const { from, to } = cursor.value;
		if (fullWord) {
			const there = state.wordAt(from);
			if (!there || there.from !== from || there.to !== to) continue;
		}
		if (!ranges.some((range) => range.from === from)) free.push({ from, to });
	}
	const first = ranges[0].from;
	const before = free.filter((match) => match.to <= first);
	const found = before.length > 0 ? before[before.length - 1] : free.at(-1);
	if (!found) return false;
	dispatch(
		state.update({
			selection: state.selection.addRange(
				EditorSelection.range(found.from, found.to),
				false,
			),
			effects: EditorView.scrollIntoView(found.from),
			userEvent: 'select',
		}),
	);
	return true;
};

/** Overleaf's keys, before CodeMirror's own (where Ctrl+D is the next occurrence). */
export const overleafSelectionKeys: readonly KeyBinding[] = [
	{ key: 'Mod-d', run: deleteLine, preventDefault: true },
	{
		key: 'Mod-Alt-ArrowRight',
		run: selectNextOccurrence,
		preventDefault: true,
	},
	{
		key: 'Mod-Alt-ArrowLeft',
		run: selectPreviousOccurrence,
		preventDefault: true,
	},
];
