import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { latexTypstBidiIsolates } from '@src/extensions/codemirror/BidiExtension';

const viewOf = (doc: string) =>
	new EditorView({
		state: EditorState.create({ doc, extensions: [latexTypstBidiIsolates()] }),
		parent: document.body,
	});

// The ranges the view isolates (the facet the extension feeds).
const isolated = (view: EditorView) => {
	let count = 0;
	for (const source of view.state.facet(EditorView.bidiIsolatedRanges)) {
		const set = typeof source === 'function' ? source(view) : source;
		set.between(0, view.state.doc.length, () => {
			count++;
		});
	}
	return count;
};

describe('bidi isolates', () => {
	it('isolates nothing in a document written left to right', () => {
		const view = viewOf('Texte avec \\cite{a} et $x^2$ en français.\n');
		expect(isolated(view)).toBe(0);
		view.dispatch({ changes: { from: 0, insert: '\\section{Titre} ' } });
		expect(isolated(view)).toBe(0);
		view.destroy();
	});

	it('isolates the commands of a document with Hebrew or Arabic', () => {
		const view = viewOf('שלום \\textbf{עולם} ו־$x^2$.\n');
		expect(isolated(view)).toBeGreaterThan(0);
		view.destroy();
	});

	it('starts isolating once right-to-left text is typed', () => {
		const view = viewOf('Texte avec \\cite{a}.\n');
		expect(isolated(view)).toBe(0);
		view.dispatch({ changes: { from: 0, insert: 'مرحبا ' } });
		expect(isolated(view)).toBeGreaterThan(0);
		view.destroy();
	});
});
