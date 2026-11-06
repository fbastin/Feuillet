import {
	authorSurnames,
	displayText,
	authorsLabel,
	plainText,
	searchReferences,
} from '../../../src/utils/referenceSearch';

const entries = [
	{
		key: 'Ein05',
		title: 'Zur Elektrodynamik bewegter K{\\"o}rper',
		authors: ['Einstein, Albert'],
		year: '1905',
		journal: 'Annalen der Physik',
	},
	{
		key: 'epr1935',
		title: 'Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?',
		authors: ['Einstein, A. and Podolsky, B. and Rosen, N.'],
		year: '1935',
		journal: 'Physical Review',
	},
	{
		key: 'bastin2006',
		title: 'Adaptive trust-region methods',
		authors: ["Fabian Bastin and C{\\'e}cile Cirillo and Philippe L. Toint"],
		year: '2006',
		journal: 'Mathematical Programming',
	},
	{
		key: 'schrodinger1926',
		title: 'Quantisierung als Eigenwertproblem',
		authors: ['Schr{\\"o}dinger, Erwin'],
		year: '1926',
		journal: 'Annalen der Physik',
	},
	{
		key: 'waals1873',
		title: 'Over de continuiteit van den gas- en vloeistoftoestand',
		authors: ['{van der Waals}, Johannes Diderik'],
		year: '1873',
	},
];
const keys = (query: string) => searchReferences(entries, query).map((entry) => entry.key);

describe('advanced reference search, as on Overleaf', () => {
	it('finds by key, author, title, year or journal', () => {
		expect(keys('Ein05')).toEqual(['Ein05']);
		expect(keys('podolsky')).toEqual(['epr1935']);
		expect(keys('quantum')).toEqual(['epr1935']);
		expect(keys('1926')).toEqual(['schrodinger1926']);
		expect(keys('programming')).toEqual(['bastin2006']);
	});

	it('wants every word, in any order', () => {
		expect(keys('einstein 1905')).toEqual(['Ein05']);
		expect(keys('1935 einstein')).toEqual(['epr1935']);
		expect(keys('einstein 2006')).toEqual([]);
		expect(keys('annalen physik')).toEqual(['Ein05', 'schrodinger1926']);
	});

	it('reads accents, typed or in BibTeX', () => {
		expect(keys('schrödinger')).toEqual(['schrodinger1926']);
		expect(keys('schrodinger')).toEqual(['schrodinger1926']);
		expect(keys('cécile')).toEqual(['bastin2006']);
		expect(keys('korper')).toEqual(['Ein05']);
		expect(keys('KÖRPER')).toEqual(['Ein05']);
	});

	it('ranks the key, then names, before titles', () => {
		// « ein » begins the key Ein05 and the name Einstein; the title of
		// schrodinger1926 has « Eigenwertproblem », not « ein… ».
		expect(keys('ein')).toEqual(['Ein05', 'epr1935']);
		expect(keys('bastin')[0]).toBe('bastin2006');
	});

	it('gives everything by key for an empty query, at most the limit', () => {
		expect(keys('')).toEqual(['bastin2006', 'Ein05', 'epr1935', 'schrodinger1926', 'waals1873']);
		expect(searchReferences(entries, '', 2)).toHaveLength(2);
	});

	it('names the authors briefly', () => {
		expect(authorSurnames(['Einstein, A. and Podolsky, B. and others'])).toEqual(['Einstein', 'Podolsky']);
		expect(authorSurnames(['Jean {de La Fontaine} and Victor Hugo'])).toEqual(['de La Fontaine', 'Hugo']);
		expect(authorSurnames(['{van der Waals}, Johannes'])).toEqual(['van der Waals']);
		expect(authorsLabel(['Einstein, Albert'])).toBe('Einstein');
		expect(authorsLabel(['Einstein, A. and Rosen, N.'])).toBe('Einstein, Rosen');
		expect(authorsLabel(['Einstein, A. and Podolsky, B. and Rosen, N.'])).toBe('Einstein et al.');
		expect(authorsLabel([])).toBe('');
	});

	it('shows BibTeX text as it reads', () => {
		expect(displayText('Zur Elektrodynamik bewegter K{\\"o}rper')).toBe('Zur Elektrodynamik bewegter Körper');
		expect(displayText('Fran\\c{c}ois et \\v{S}koda')).toBe('François et Škoda');
		expect(displayText("Erd\\H{o}s, P{\\'\\i}a and \\'Emile")).toBe('Erdős, Pía and Émile');
		expect(displayText('Stra{\\ss}e, pages 1--10 \\& more')).toBe('Straße, pages 1–10 & more');
		expect(displayText('{The} \\emph{Large}~Scale')).toBe('The Large Scale');
		expect(authorSurnames(["Jos{\\'e} Mart{\\'\\i}nez", 'Schr{\\"o}dinger, Erwin'])).toEqual(['Martínez', 'Schrödinger']);
	});

	it('turns LaTeX into plain text', () => {
		expect(plainText('Stra{\\ss}e')).toBe('strasse');
		expect(plainText('\\emph{Large} scale~methods')).toBe('large scale methods');
		expect(plainText('Ma{\\c{c}}on')).toBe('macon');
		expect(plainText('$\\alpha$-stable')).toBe('-stable');
	});
});
