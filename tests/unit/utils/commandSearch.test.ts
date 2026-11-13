// The command palette's search (src/utils/commandSearch.ts): words in any
// order, accents and case aside, word starts first, scattered letters last.
import { highlightPieces, matchText } from '@src/utils/commandSearch';

const score = (query: string, text: string) => matchText(query, text)?.score ?? null;

describe('command search', () => {
	it('finds words in any order, accents and case aside', () => {
		expect(matchText('pdf aller', 'Aller à cet endroit dans le PDF')).not.toBeNull();
		expect(matchText('ecran', 'Plein écran')?.ranges).toEqual([[6, 11]]);
		expect(matchText('MAJ', 'En majuscules')).not.toBeNull();
		expect(matchText('tableau x', 'Tableau')).toBeNull();
	});

	it('everything for an empty query', () => {
		expect(matchText('  ', 'Compiler le document')).toEqual({ score: 0, ranges: [] });
	});

	it('ranks a word start above the inside of a word, above scattered letters', () => {
		const start = score('comp', 'Compiler le document');
		const inside = score('pile', 'Compiler le document');
		const scattered = score('cpl', 'Compiler le document');
		expect(start).toBeGreaterThan(inside as number);
		expect(inside).toBeGreaterThan(scattered as number);
		// The beginning of the text, before a later word start.
		expect(score('comp', 'Compiler')).toBeGreaterThan(score('comp', 'Arrêter la compilation') as number);
		// Shorter texts first.
		expect(score('fig', 'Figure')).toBeGreaterThan(score('fig', 'Figure avec légende et options') as number);
	});

	it('finds scattered letters only from a word start, in order', () => {
		expect(matchText('mtx', 'main.tex')?.ranges).toEqual([[0, 1], [5, 6], [7, 8]]);
		expect(matchText('xtm', 'main.tex')).toBeNull();
		expect(matchText('ain', 'main.tex')?.ranges).toEqual([[1, 4]]);
		// A capital after a small letter starts a word.
		expect(matchText('cf', 'chapterFour.tex')?.ranges).toEqual([[0, 1], [7, 8]]);
	});

	it('cuts the text to show what matched', () => {
		const match = matchText('doc comp', 'Compiler le document');
		expect(highlightPieces('Compiler le document', match?.ranges ?? [])).toEqual([
			{ text: 'Comp', match: true, at: 0 },
			{ text: 'iler le ', match: false, at: 4 },
			{ text: 'doc', match: true, at: 12 },
			{ text: 'ument', match: false, at: 15 },
		]);
		expect(highlightPieces('Thèse', [[0, 3]])).toEqual([
			{ text: 'Thè', match: true, at: 0 },
			{ text: 'se', match: false, at: 3 },
		]);
	});
});
