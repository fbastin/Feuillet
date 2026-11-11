// src/extensions/codemirror/multipleSelections.ts
// Several cursors and selections at once, as on Overleaf: Ctrl+D (⌘D) adds
// the next occurrence of the selection, Ctrl+Alt+↑/↓ a cursor on the line
// above or below, Ctrl+click (⌘-click) a cursor where it clicks — except on
// a link, which it still follows —, Alt+drag selects a rectangle, and
// Escape keeps only the main one. What is typed goes to every cursor.
import { EditorState, type Extension, Prec } from '@codemirror/state';
import {
	crosshairCursor,
	drawSelection,
	EditorView,
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
