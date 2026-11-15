import { applyBibChanges, parseBibDocument } from '@/utils/bibDocument';
import {
	CLEANUP_KINDS,
	type CleanupKind,
	capitalStyleOf,
	cleanDoi,
	cleanPages,
	cleanupChanges,
	escapeSpecials,
	protectCapitals,
	repairEncoding,
	unicodeToLatex,
} from '@/utils/bibCleanup';

describe('the cleanups of a value', () => {
	it('writes page ranges with --', () => {
		expect(cleanPages('12-34')).toBe('12--34');
		expect(cleanPages('495 -507')).toBe('495--507');
		expect(cleanPages('12–34, e1—e9')).toBe('12--34, e1--e9');
		expect(cleanPages('iv-xii')).toBe('iv--xii');
		expect(cleanPages('12--34')).toBe('12--34');
		expect(cleanPages('e1003')).toBe('e1003');
		expect(cleanPages('2-s2.0-8455')).toBe('2-s2.0-8455');
	});

	it('takes the link off a DOI', () => {
		expect(cleanDoi('https://doi.org/10.1016/j.ejor.2020.06.041')).toBe(
			'10.1016/j.ejor.2020.06.041',
		);
		expect(cleanDoi('http://dx.doi.org/10.1/x')).toBe('10.1/x');
		expect(cleanDoi('doi: 10.1/x')).toBe('10.1/x');
	});

	it('escapes & % # _ outside math, URLs and JabRef’s macros', () => {
		expect(escapeSpecials('Statistics & Data Analysis, 20% of #1')).toBe(
			'Statistics \\& Data Analysis, 20\\% of \\#1',
		);
		expect(escapeSpecials('Already \\& done')).toBe('Already \\& done');
		expect(escapeSpecials('the $x_i$ and \\url{http://a.b/c_d#e}')).toBe(
			'the $x_i$ and \\url{http://a.b/c_d#e}',
		);
		expect(escapeSpecials('#may#')).toBe('#may#');
	});

	it('reads again UTF-8 read as Latin-1 or Windows-1252', () => {
		expect(repairEncoding('TrÃ©panier and JÃ¼rgen')).toBe(
			'Trépanier and Jürgen',
		);
		expect(repairEncoding('acceptâ€“reject, personenautoâ€™s')).toBe(
			'accept–reject, personenauto’s',
		);
		// Twice over.
		expect(repairEncoding('LabbÃƒÂ©')).toBe('Labbé');
		// Not UTF-8: as it is.
		expect(repairEncoding('São Paulo, Ãvila')).toBe('São Paulo, Ãvila');
	});

	it('writes accents and typography in LaTeX', () => {
		expect(unicodeToLatex('Trépanier, Jürgen, Rodríguez, Øksendal, Straße')).toBe(
			"Tr{\\'e}panier, J{\\\"u}rgen, Rodr{\\'\\i}guez, {\\O}ksendal, Stra{\\ss}e",
		);
		expect(unicodeToLatex('Čech, Gauss–Newton, “quoted”')).toBe(
			"{\\v{C}}ech, Gauss--Newton, ``quoted''",
		);
		expect(unicodeToLatex('H\\ärdle')).toBe('H{\\"a}rdle');
		expect(unicodeToLatex('α-stable')).toBe('α-stable');
	});

	it('protects acronyms, and proper nouns in a sentence-case title', () => {
		expect(
			protectCapitals('Solving the subproblem using the Lanczos method, in SIAM'),
		).toBe('Solving the subproblem using the {Lanczos} method, in {SIAM}');
		expect(protectCapitals('BIOGEME: a free package for 3D models in R')).toBe(
			'{BIOGEME}: a free package for {3D} models in {R}',
		);
		// Title case: the capitals of every word cannot tell proper nouns.
		expect(protectCapitals('New MINLP Model and Outer Approximation')).toBe(
			'New {MINLP} Model and Outer Approximation',
		);
		// As the file writes: {M}onte.
		expect(
			protectCapitals('The Mixed Logit model: the state of practice', 'letter'),
		).toBe('The {M}ixed {L}ogit model: the state of practice');
	});

	it('leaves what is protected, math, commands, ALL CAPS', () => {
		expect(protectCapitals('Smart {M}onte {C}arlo: various tricks')).toBe(
			'Smart {M}onte {C}arlo: various tricks',
		);
		expect(protectCapitals('a study of $\\mathcal{O}(N)$ and \\emph{Hello}')).toBe(
			'a study of $\\mathcal{O}(N)$ and \\emph{Hello}',
		);
		expect(protectCapitals('A STUDY OF THINGS')).toBe('A STUDY OF THINGS');
		expect(protectCapitals("on G{\\\"o}del's theorem")).toBe(
			"on {G{\\\"o}del}'s theorem",
		);
	});
});

describe('cleanupChanges', () => {
	const TEXT = `@string{csda = {Computational Statistics}}

@Article{a,
  Title   = {The Mixed Logit model: the state of practice},
  Author  = {TrÃ©panier, Martin},
  Journal = csda,
  Pages   = {12-34},
  Doi     = {https://doi.org/10.1/x_y},
  Url     = {https://example.org/a_b},
  Note    = {20% of {M}onte {C}arlo},
}

@article{b,
  title = {Nothing to do},
  pages = {1--2},
}
`;
	const document = parseBibDocument(TEXT);
	const all = new Set<CleanupKind>(CLEANUP_KINDS);

	it('changes each value in place, not macros, URLs or DOIs', () => {
		const changes = cleanupChanges(document, all);
		expect(changes.map((change) => [change.key, change.field, change.kinds])).toEqual([
			['a', 'Title', ['capitals']],
			['a', 'Author', ['encoding', 'latex']],
			['a', 'Pages', ['pages']],
			['a', 'Doi', ['doi']],
			['a', 'Note', ['escape']],
		]);
		expect(applyBibChanges(TEXT, changes)).toBe(
			TEXT.replace(
				'{The Mixed Logit model:',
				'{The {Mixed} {Logit} model:',
			)
				.replace('{TrÃ©panier, Martin}', "{Tr{\\'e}panier, Martin}")
				.replace('{12-34}', '{12--34}')
				.replace('{https://doi.org/10.1/x_y}', '{10.1/x_y}')
				.replace('{20% of', '{20\\% of'),
		);
	});

	it('does only the cleanups asked, in the entries asked', () => {
		expect(
			cleanupChanges(document, new Set(['pages']), [1]).map((c) => c.key),
		).toEqual([]);
		expect(
			cleanupChanges(document, new Set(['pages'])).map((c) => c.after),
		).toEqual(['12--34']);
	});

	it('protects capitals as the file does', () => {
		expect(capitalStyleOf(document)).toBe('word');
		expect(
			capitalStyleOf(parseBibDocument('@a{x, title = {Smart {M}onte {C}arlo}}')),
		).toBe('letter');
	});
});
