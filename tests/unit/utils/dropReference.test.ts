import { dropReference, treeDragOf } from '@src/utils/dropReference';

describe('a file dropped from the file tree', () => {
	it('reads what the file tree puts in a drag, nothing else', () => {
		expect(treeDragOf('{"nodeId":"a1","nodePath":"/images/plot.png","nodeType":"file"}')).toEqual({ nodeId: 'a1', nodePath: '/images/plot.png', nodeType: 'file' });
		expect(treeDragOf('Bonjour')).toBeNull();
		expect(treeDragOf('{"text":"x"}')).toBeNull();
		expect(treeDragOf('{not json')).toBeNull();
		expect(treeDragOf('{"nodeId":"a","nodePath":"/x","nodeType":"link"}')).toBeNull();
	});

	it('in LaTeX: a figure, \\input, the bibliography as the document makes it, else the path', () => {
		expect(dropReference('latex', 'images/plot.png', '')).toEqual({ kind: 'figure' });
		expect(dropReference('latex', 'images/plot.PDF', '')).toEqual({ kind: 'figure' });
		expect(dropReference('latex', 'chapitres/intro.tex', '')).toEqual({ kind: 'text', text: '\\input{chapitres/intro}' });
		expect(dropReference('latex', 'refs.bib', '\\documentclass{article}')).toEqual({ kind: 'text', text: '\\bibliography{refs}' });
		expect(dropReference('latex', 'refs.bib', '\\usepackage[style=apa]{biblatex}')).toEqual({ kind: 'text', text: '\\addbibresource{refs.bib}' });
		expect(dropReference('latex', 'data/table.csv', '')).toEqual({ kind: 'text', text: 'data/table.csv' });
		expect(dropReference('latex', 'images', '', 'directory')).toEqual({ kind: 'text', text: 'images' });
	});

	it('in Typst and Markdown', () => {
		expect(dropReference('typst', 'images/logo.svg', '')).toEqual({ kind: 'figure' });
		expect(dropReference('typst', 'chapitre.typ', '')).toEqual({ kind: 'text', text: '#include "chapitre.typ"' });
		expect(dropReference('typst', 'refs.bib', '')).toEqual({ kind: 'text', text: '#bibliography("refs.bib")' });
		expect(dropReference('markdown', 'images/plot.png', '')).toEqual({ kind: 'figure' });
		expect(dropReference('markdown', 'notes.txt', '')).toEqual({ kind: 'text', text: 'notes.txt' });
	});
});
