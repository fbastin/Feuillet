import { LookupError, lookUpIdentifier } from '../../../src/services/BibMetadataService';
import { documentLayout, parseBibDocument, writeEntry } from '../../../src/utils/bibDocument';
import {
	arxivCategory,
	fromCsl,
	fromOpenLibrary,
	makeKey,
	toBibEntry,
	toLatex,
} from '../../../src/utils/bibFromMetadata';
import { isbn13, isbnValid, parseIdentifier } from '../../../src/utils/bibIdentifiers';

// As doi.org answers (CSL-JSON), trimmed.
const EPR = {
	type: 'article-journal',
	title: 'Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?',
	author: [
		{ given: 'A.', family: 'Einstein' },
		{ given: 'B.', family: 'Podolsky' },
		{ given: 'N.', family: 'Rosen' },
	],
	'container-title': 'Physical Review',
	volume: '47',
	issue: '10',
	page: '777-780',
	publisher: 'American Physical Society (APS)',
	issued: { 'date-parts': [[1935, 5, 15]] },
	DOI: '10.1103/physrev.47.777',
	URL: 'http://dx.doi.org/10.1103/physrev.47.777',
};

const ATTENTION = {
	type: 'article',
	categories: [
		'Computation and Language (cs.CL)',
		'Machine Learning (cs.LG)',
		'FOS: Computer and information sciences',
	],
	author: [
		{ family: 'Vaswani', given: 'Ashish' },
		{ family: 'Shazeer', given: 'Noam' },
	],
	issued: { 'date-parts': [[2017]] },
	DOI: '10.48550/ARXIV.1706.03762',
	publisher: 'arXiv',
	title: 'Attention Is All You Need',
	URL: 'https://arxiv.org/abs/1706.03762',
};

const NOCEDAL = {
	type: 'book',
	title: ['Numerical Optimization'],
	author: [
		{ given: 'Jorge', family: 'Nocedal' },
		{ given: 'Stephen J.', family: 'Wright' },
	],
	'container-title': ['Springer Series in Operations Research and Financial Engineering'],
	publisher: 'Springer New York',
	issued: { 'date-parts': [[2006]] },
	DOI: '10.1007/978-0-387-40065-5',
	ISBN: ['9780387303031', '9780387400655'],
};

const TEXBOOK = {
	title: 'The TeXbook',
	authors: [{ name: 'Donald Knuth' }],
	publishers: [{ name: 'Addison-Wesley' }],
	publish_places: [{ name: 'Reading, Mass' }],
	publish_date: '1986',
};

describe('identifiers', () => {
	it('reads DOIs as written, linked or prefixed', () => {
		for (const input of [
			'10.1103/PhysRev.47.777',
			'doi:10.1103/PhysRev.47.777',
			'https://doi.org/10.1103/PhysRev.47.777',
			' https://dx.doi.org/10.1103%2FPhysRev.47.777. ',
		]) {
			expect(parseIdentifier(input)).toEqual({ kind: 'doi', id: '10.1103/PhysRev.47.777' });
		}
	});

	it('reads arXiv numbers, new and old, without their version', () => {
		expect(parseIdentifier('1706.03762v5')).toEqual({ kind: 'arxiv', id: '1706.03762' });
		expect(parseIdentifier('arXiv:2401.01234')).toEqual({ kind: 'arxiv', id: '2401.01234' });
		expect(parseIdentifier('https://arxiv.org/pdf/1706.03762v7.pdf')).toEqual({ kind: 'arxiv', id: '1706.03762' });
		expect(parseIdentifier('hep-th/9711200')).toEqual({ kind: 'arxiv', id: 'hep-th/9711200' });
		expect(parseIdentifier('math.AG/0309136v2')).toEqual({ kind: 'arxiv', id: 'math.AG/0309136' });
		expect(parseIdentifier('10.48550/arXiv.1706.03762')).toEqual({ kind: 'arxiv', id: '1706.03762' });
	});

	it('reads ISBNs, checking their check digit', () => {
		expect(parseIdentifier('ISBN 0-201-13447-0')).toEqual({ kind: 'isbn', id: '0201134470' });
		expect(parseIdentifier('978-0-262-03561-3')).toEqual({ kind: 'isbn', id: '9780262035613' });
		expect(parseIdentifier('0-201-13447-1')).toEqual({ kind: 'invalid-isbn', id: '0201134471' });
		expect(isbnValid('080442957X')).toBe(true);
		expect(isbn13('0201134470')).toBe('9780201134476');
	});

	it('is none of them otherwise', () => {
		expect(parseIdentifier('0-201-13447')).toBeNull();
		expect(parseIdentifier('einstein 1935')).toBeNull();
		expect(parseIdentifier('')).toBeNull();
		expect(parseIdentifier('https://example.org/10.1103/x')).toBeNull();
	});
});

describe('LaTeX from metadata', () => {
	it('escapes, turns Crossref’s tags into commands and keeps braces balanced', () => {
		expect(toLatex('R&amp;D at 100% <i>in vivo</i> of H<sub>2</sub>O_x')).toBe(
			'R\\&D at 100\\% \\emph{in vivo} of H\\textsubscript{2}O\\_x',
		);
		expect(toLatex('<i>unclosed')).toBe('\\emph{unclosed}');
		expect(toLatex('a <mml:math><mml:mi>x</mml:mi></mml:math> b')).toBe('a x b');
	});

	it('puts a title’s acronyms in braces, not an all-caps title’s words', () => {
		expect(toLatex('DNA repair in LaTeX and mRNA on GPUs', true)).toBe(
			'{DNA} repair in {LaTeX} and {mRNA} on {GPUs}',
		);
		expect(toLatex('A STUDY OF THINGS', true)).toBe('A STUDY OF THINGS');
		expect(toLatex('The Large N Limit, Part I: A Study', true)).toBe(
			'The Large {N} Limit, Part {I}: A Study',
		);
	});
});

describe('entries from metadata', () => {
	it('writes a journal article in BibTeX: journal, year and month', () => {
		const { type, fields } = toBibEntry(fromCsl(EPR), 'bibtex');
		expect(type).toBe('article');
		expect(fields).toEqual([
			['author', 'Einstein, A. and Podolsky, B. and Rosen, N.'],
			['title', 'Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?'],
			['journal', 'Physical Review'],
			['volume', '47'],
			['number', '10'],
			['pages', '777--780'],
			['publisher', 'American Physical Society (APS)'],
			['year', '1935'],
			['month', 'may'],
			['doi', '10.1103/physrev.47.777'],
		]);
	});

	it('writes it in biblatex: journaltitle and date', () => {
		const fields = Object.fromEntries(toBibEntry(fromCsl(EPR), 'biblatex').fields);
		expect(fields.journaltitle).toBe('Physical Review');
		expect(fields.date).toBe('1935-05-15');
		expect(fields.year).toBeUndefined();
	});

	it('writes an arXiv preprint with its eprint, as arXiv and biblatex want it', () => {
		const meta = { ...fromCsl(ATTENTION), arxiv: { id: '1706.03762', primaryClass: arxivCategory(ATTENTION) } };
		const bibtex = toBibEntry(meta, 'bibtex');
		expect(bibtex.type).toBe('misc');
		expect(Object.fromEntries(bibtex.fields)).toMatchObject({
			eprint: '1706.03762',
			archiveprefix: 'arXiv',
			primaryclass: 'cs.CL',
			doi: '10.48550/arXiv.1706.03762',
			url: 'https://arxiv.org/abs/1706.03762',
		});
		expect(Object.fromEntries(bibtex.fields).publisher).toBeUndefined();
		expect(Object.fromEntries(toBibEntry(meta, 'biblatex').fields)).toMatchObject({
			eprinttype: 'arxiv',
			eprintclass: 'cs.CL',
			date: '2017',
		});
	});

	it('writes a book: its series, publisher and ISBN', () => {
		const { type, fields } = toBibEntry({ ...fromCsl(NOCEDAL), isbn: '9780387303031' }, 'bibtex');
		expect(type).toBe('book');
		expect(Object.fromEntries(fields)).toMatchObject({
			author: 'Nocedal, Jorge and Wright, Stephen J.',
			title: 'Numerical Optimization',
			series: 'Springer Series in Operations Research and Financial Engineering',
			publisher: 'Springer New York',
			isbn: '9780387303031',
		});
		const knuth = toBibEntry(fromOpenLibrary(TEXBOOK, '0201134470'), 'biblatex');
		expect(Object.fromEntries(knuth.fields)).toMatchObject({
			author: 'Donald Knuth',
			title: 'The {TeXbook}',
			location: 'Reading, Mass',
			date: '1986',
			isbn: '0201134470',
		});
	});

	it('writes a chapter in its book, the series apart (Crossref lists both)', () => {
		const chapter = fromCsl({
			type: 'book-chapter',
			title: ['Line Search Methods'],
			author: NOCEDAL.author,
			'container-title': ['Springer Series in Operations Research and Financial Engineering', 'Numerical Optimization'],
			page: '30-65',
			publisher: 'Springer New York',
			'publisher-location': 'New York, NY',
			issued: { 'date-parts': [[2006]] },
		});
		expect(Object.fromEntries(toBibEntry(chapter, 'bibtex').fields)).toMatchObject({
			booktitle: 'Numerical Optimization',
			series: 'Springer Series in Operations Research and Financial Engineering',
			address: 'New York, NY',
			pages: '30--65',
		});
	});

	it('writes a thesis for each dialect', () => {
		const thesis = fromCsl({ type: 'thesis', genre: 'PhD thesis', title: 'T', author: [{ family: 'Doe', given: 'J.' }], publisher: 'Université de Montréal', issued: { 'date-parts': [[2020]] } });
		expect(toBibEntry(thesis, 'bibtex').type).toBe('phdthesis');
		expect(Object.fromEntries(toBibEntry(thesis, 'bibtex').fields).school).toBe('Université de Montréal');
		const biblatex = toBibEntry(thesis, 'biblatex');
		expect(biblatex.type).toBe('thesis');
		expect(Object.fromEntries(biblatex.fields)).toMatchObject({ type: 'phdthesis', institution: 'Université de Montréal' });
	});

	it('makes a key that is not taken, in the file’s style', () => {
		const meta = fromCsl(EPR);
		expect(makeKey(meta, [])).toBe('einstein1935');
		expect(makeKey(meta, ['Einstein1935', 'einstein1935a'])).toBe('einstein1935b');
		expect(makeKey(meta, ['Knuth1984', 'Doe2020'])).toBe('Einstein1935');
		expect(makeKey(fromCsl({ title: 'x', author: [{ family: 'Schrödinger' }], issued: { 'date-parts': [[1926]] } }), [])).toBe('schrodinger1926');
	});
});

describe('writing the new entry like the file', () => {
	it('follows the file’s indentation and aligned « = »', () => {
		const text = '@book{k,\n    author    = {A},\n    publisher = {P},\n}\n';
		const layout = documentLayout(text);
		expect(layout).toMatchObject({ indent: '    ', aligned: true, trailingComma: true });
		const written = writeEntry('article', 'e', [['author', 'X'], ['year', '1935'], ['month', 'may']], layout, (name) => name === 'month');
		expect(written).toBe('@article{e,\n    author = {X},\n    year   = {1935},\n    month  = may,\n}');
		expect(parseBibDocument(written).errors).toEqual([]);
	});

	it('writes two spaces and « = » between spaces in an empty file', () => {
		expect(writeEntry('misc', 'k', [['title', 'T']], documentLayout(''))).toBe('@misc{k,\n  title = {T}\n}');
	});
});

describe('looking up', () => {
	// jsdom has no Response: what the service reads of one.
	const respond = (status: number, body: unknown) =>
		Promise.resolve({
			status,
			ok: status >= 200 && status < 300,
			json: async () => {
				if (body === undefined) throw new SyntaxError('no body');
				return body;
			},
		});

	it('asks Crossref for a DOI, the DOI encoded', async () => {
		const fetchImpl = jest.fn(() => respond(200, { message: EPR }));
		const meta = await lookUpIdentifier({ kind: 'doi', id: '10.1000/a#b' }, fetchImpl as unknown as typeof fetch);
		expect(meta?.title).toContain('Quantum');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://api.crossref.org/works/10.1000/a%23b');
	});

	it('asks doi.org for CSL-JSON when Crossref does not know the DOI', async () => {
		const fetchImpl = jest.fn((url: string) =>
			url.includes('crossref') ? respond(404, undefined) : respond(200, ATTENTION),
		);
		const meta = await lookUpIdentifier({ kind: 'doi', id: '10.5281/zenodo.1' }, fetchImpl as unknown as typeof fetch);
		expect(meta?.title).toBe('Attention Is All You Need');
		const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
		expect(url).toBe('https://doi.org/10.5281/zenodo.1');
		expect((init.headers as Record<string, string>).Accept).toBe('application/vnd.citationstyles.csl+json');
	});

	it('asks arXiv’s DataCite DOI for an arXiv number', async () => {
		const fetchImpl = jest.fn(() => respond(200, ATTENTION));
		const meta = await lookUpIdentifier({ kind: 'arxiv', id: 'hep-th/9711200' }, fetchImpl as unknown as typeof fetch);
		expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://doi.org/10.48550/arXiv.hep-th/9711200');
		expect(meta?.arxiv).toEqual({ id: 'hep-th/9711200', primaryClass: 'cs.CL' });
	});

	it('takes Crossref’s book for an ISBN, else Open Library’s', async () => {
		const crossref = jest.fn((url: string) =>
			url.includes('crossref') ? respond(200, { message: { items: [NOCEDAL] } }) : respond(200, {}),
		);
		expect((await lookUpIdentifier({ kind: 'isbn', id: '9780387303031' }, crossref as unknown as typeof fetch))?.doi).toBe('10.1007/978-0-387-40065-5');
		const openLibrary = jest.fn((url: string) =>
			url.includes('crossref') ? respond(200, { message: { items: [] } }) : respond(200, { 'ISBN:0201134470': TEXBOOK }),
		);
		const knuth = await lookUpIdentifier({ kind: 'isbn', id: '0201134470' }, openLibrary as unknown as typeof fetch);
		expect(knuth?.title).toBe('The TeXbook');
		expect((openLibrary.mock.calls[0] as unknown as [string])[0]).toContain('isbn:9780201134476');
	});

	it('gives null for an unknown DOI, an error when the service fails', async () => {
		expect(await lookUpIdentifier({ kind: 'doi', id: '10.9999/none' }, (() => respond(404, undefined)) as unknown as typeof fetch)).toBeNull();
		await expect(lookUpIdentifier({ kind: 'doi', id: '10.1/x' }, (() => respond(503, undefined)) as unknown as typeof fetch)).rejects.toMatchObject({ service: 'doi.org', status: 503 });
		await expect(lookUpIdentifier({ kind: 'doi', id: '10.1/x' }, (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch)).rejects.toBeInstanceOf(LookupError);
	});
});
