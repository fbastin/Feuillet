// src/extensions/codemirror/lineFeeds.ts
// For an editor bound to a shared text (src/utils/lineEndings.ts): lines
// break at \n alone, so that a \r, until it is taken out of the shared text
// (or for good, for those who may only read), is one character in the
// editor as in the text, the positions of both the same; and it is not
// shown.
import { EditorState, type Extension } from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	EditorView,
	MatchDecorator,
	ViewPlugin,
	type ViewUpdate,
} from '@codemirror/view';

const hidden = new MatchDecorator({
	regexp: /\r/g,
	decoration: () => Decoration.replace({}),
});

const hideCarriageReturns = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = hidden.createDeco(view);
		}
		update(update: ViewUpdate) {
			this.decorations = hidden.updateDeco(update, this.decorations);
		}
	},
	{
		decorations: (plugin) => plugin.decorations,
		provide: (plugin) =>
			EditorView.atomicRanges.of(
				(view) => view.plugin(plugin)?.decorations ?? Decoration.none,
			),
	},
);

export const sharedTextLineFeeds = (): Extension => [
	EditorState.lineSeparator.of('\n'),
	hideCarriageReturns,
];
