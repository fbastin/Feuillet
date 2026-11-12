import { trailAt } from '@src/components/editor/SectionTrail';

const LATEX = String.raw`\documentclass{book}
\begin{document}
\chapter{Introduction}
Du texte.
\section{Contexte}
\subsection*{Historique}
Encore.
\section{Méthodes}
Ici.
\chapter{Résultats}
`;

describe('the section trail', () => {
	const at = (line: number) =>
		trailAt(LATEX.split('\n').slice(0, line).join('\n'), line, 'latex').map(
			(heading) => heading.title,
		);

	it('is empty before the first heading', () => {
		expect(at(2)).toEqual([]);
	});

	it('names the headings the cursor is under, the outermost first', () => {
		expect(at(4)).toEqual(['Introduction']);
		expect(at(7)).toEqual(['Introduction', 'Contexte', 'Historique']);
		expect(at(9)).toEqual(['Introduction', 'Méthodes']);
		expect(at(10)).toEqual(['Résultats']);
	});

	it('with the line of each, to go to it', () => {
		expect(trailAt(LATEX, 7, 'latex').map((heading) => heading.line)).toEqual([
			3, 5, 6,
		]);
	});

	it("follows Typst's headings", () => {
		const typst = '= Introduction\nTexte.\n== Contexte\nIci.\n= Suite\n';
		expect(trailAt(typst, 4, 'typst').map((heading) => heading.title)).toEqual([
			'Introduction',
			'Contexte',
		]);
	});
});
