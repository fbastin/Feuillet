// src/extensions/codemirror/BidiExtension.ts
import {
	RangeSetBuilder,
	type Extension,
	StateField,
	StateEffect,
} from '@codemirror/state';
import {
	Decoration,
	Direction,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	type DecorationSet,
} from '@codemirror/view';

import { allBidiPatterns } from './bidi/patterns';

type TextRange = { from: number; to: number };

export const setMathEditRegion = StateEffect.define<TextRange | null>();

const mathEditRegionField = StateField.define<TextRange | null>({
	create() {
		return null;
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setMathEditRegion)) {
				return effect.value;
			}
		}
		return value;
	},
});

const isolate = Decoration.mark({
	attributes: { style: 'unicode-bidi: isolate; direction: ltr;' },
	bidiIsolate: Direction.LTR,
});

// Letters written right to left (Hebrew, Arabic, Syriac, Thaana, NKo,
// Samaritan, Mandaic and their presentation forms). Without any, isolating
// commands changes nothing on screen.
const RIGHT_TO_LEFT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function rangesOverlap(r1: TextRange, r2: TextRange): boolean {
	return r1.from < r2.to && r2.from < r1.to;
}

class LatexTypstBidiIsolatesValue {
	decorations: DecorationSet;
	// Whether the document has right-to-left letters: looked for once, then
	// only in what is typed (a letter deleted later leaves it true). Until
	// then nothing is built: the build reads the whole document at every
	// keystroke, 15 ms a key in a thesis chapter of 6,000 lines.
	private rightToLeft: boolean;

	constructor(readonly view: EditorView) {
		this.rightToLeft = RIGHT_TO_LEFT.test(view.state.doc.toString());
		this.decorations = this.rightToLeft ? this.build(view) : Decoration.none;
	}

	update(update: ViewUpdate) {
		if (!this.rightToLeft && update.docChanged) {
			update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
				if (!this.rightToLeft && RIGHT_TO_LEFT.test(inserted.toString())) {
					this.rightToLeft = true;
				}
			});
		}
		if (!this.rightToLeft) return;
		if (update.docChanged || update.viewportChanged) {
			this.decorations = this.build(update.view);
		}
	}

	private build(view: EditorView): DecorationSet {
		const b = new RangeSetBuilder<Decoration>();
		const skipRegion = view.state.field(mathEditRegionField, false);
		const doc = view.state.doc.toString();
		const allRanges: TextRange[] = [];

		for (const { from: vpFrom, to: vpTo } of view.visibleRanges) {
			for (const { pattern } of allBidiPatterns) {
				pattern.lastIndex = 0;
				let match: RegExpExecArray | null;
				while ((match = pattern.exec(doc)) !== null) {
					const from = match.index;
					const to = from + match[0].length;
					if (to < vpFrom) continue;
					if (from > vpTo) break;
					allRanges.push({ from, to });
				}
			}
		}

		allRanges.sort((a, b) => a.from - b.from || a.to - b.to);

		const merged: TextRange[] = [];
		for (const range of allRanges) {
			if (merged.length === 0) {
				merged.push({ ...range });
			} else {
				const last = merged[merged.length - 1];
				if (range.from < last.to) {
					last.to = Math.max(last.to, range.to);
				} else {
					merged.push({ ...range });
				}
			}
		}

		for (const r of merged) {
			if (!skipRegion || !rangesOverlap(r, skipRegion)) {
				b.add(r.from, r.to, isolate);
			}
		}

		return b.finish();
	}
}

export function latexTypstBidiIsolates(): Extension {
	const plugin = ViewPlugin.fromClass(LatexTypstBidiIsolatesValue, {
		decorations: (v) => v.decorations,
	});

	return [
		mathEditRegionField,
		plugin,
		EditorView.bidiIsolatedRanges.of((view) => {
			const v = view.plugin(plugin);
			return v ? v.decorations : Decoration.none;
		}),
	];
}
