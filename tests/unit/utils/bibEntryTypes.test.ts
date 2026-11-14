import { parseBibDocument } from '../../../src/utils/bibDocument';
import {
	detectDialect,
	entryTypeSchema,
	fieldNames,
	latexBibliographyDialect,
	validFieldNames,
} from '../../../src/utils/bibEntryTypes';
import { displayNames, previewEntry, splitNames } from '../../../src/utils/bibPreview';

describe('entry types', () => {
	it('gives each dialect its required fields', () => {
		expect(entryTypeSchema('Article', 'bibtex').required).toEqual([
			'author',
			'title',
			'journal',
			'year',
		]);
		expect(entryTypeSchema('article', 'biblatex').required).toEqual([
			'author',
			'title',
			'journaltitle',
			['date', 'year'],
		]);
		expect(entryTypeSchema('book', 'bibtex').required[0]).toEqual([
			'author',
			'editor',
		]);
	});

	it('reads biblatex’s aliases: @phdthesis is a thesis that sets its type', () => {
		const thesis = entryTypeSchema('phdthesis', 'biblatex');
		expect(thesis.baseType).toBe('thesis');
		expect(thesis.required).not.toContain('type');
		expect(thesis.optional).toContain('type');
		expect(entryTypeSchema('thesis', 'biblatex').required).toContain('type');
		expect(fieldNames('journaltitle', 'biblatex')).toEqual(['journaltitle', 'journal']);
		expect(fieldNames('journaltitle', 'bibtex')).toEqual(['journaltitle']);
	});

	it('takes @misc’s fields for an unknown type', () => {
		const unknown = entryTypeSchema('webpage', 'bibtex');
		expect(unknown.known).toBe(false);
		expect(unknown.baseType).toBe('misc');
		expect(entryTypeSchema('online', 'bibtex').known).toBe(false);
		expect(entryTypeSchema('online', 'biblatex').known).toBe(true);
	});

	it('lists the fields of a dialect, without duplicates', () => {
		const names = validFieldNames('biblatex');
		expect(names).toContain('journaltitle');
		expect(new Set(names).size).toBe(names.length);
		expect(validFieldNames('bibtex')).not.toContain('journaltitle');
	});
});

describe('the dialect of a file', () => {
	const bibtexEntries = parseBibDocument('@article{a, journal={J}, year=2000}').entries;
	const biblatexEntries = parseBibDocument('@online{a, date={2020-01-02}}').entries;

	it('is JabRef’s mark, then the LaTeX files’, then the entries’', () => {
		expect(detectDialect(bibtexEntries, 'biblatex', 'bibtex')).toBe('biblatex');
		expect(detectDialect(biblatexEntries, null, 'bibtex')).toBe('bibtex');
		expect(detectDialect(biblatexEntries, null, null)).toBe('biblatex');
		expect(detectDialect(bibtexEntries, null, null)).toBe('bibtex');
	});

	it('is read in the LaTeX files, comments aside', () => {
		expect(latexBibliographyDialect(['\\usepackage[style=apa]{biblatex}'])).toBe('biblatex');
		expect(latexBibliographyDialect(['\\addbibresource{refs.bib}'])).toBe('biblatex');
		expect(latexBibliographyDialect(['% \\usepackage{biblatex}\n\\bibliography{refs}'])).toBe('bibtex');
		expect(latexBibliographyDialect(['\\usepackage{amsmath}'])).toBeNull();
	});
});

describe('the preview', () => {
	it('splits names at « and » outside braces', () => {
		expect(splitNames('Einstein, A. and {Barnes and Noble} and Rosen, N.')).toEqual([
			'Einstein, A.',
			'{Barnes and Noble}',
			'Rosen, N.',
		]);
		expect(displayNames('Einstein, Albert and Podolsky, Boris and others')).toBe(
			'Albert Einstein, Boris Podolsky et al.',
		);
		expect(displayNames('Schr{\\"o}dinger, Erwin and Born, Max')).toBe(
			'Erwin Schrödinger and Max Born',
		);
	});

	const preview = (text: string) => {
		const document = parseBibDocument(text);
		return previewEntry(document, document.entries[0]);
	};

	it('shows an article with its journal in italics and its DOI as a link', () => {
		const pieces = preview(
			'@string{pr = "Physical Review"}\n@article{epr, author={Einstein, A. and Podolsky, B.}, title={Can Quantum-Mechanical Description Be Considered Complete?}, journal=pr, volume=47, number=10, pages={777--780}, year=1935, doi={10.1103/PhysRev.47.777}}',
		);
		expect(pieces.map((piece) => piece.text).join('')).toBe(
			'A. Einstein and B. Podolsky (1935). Can Quantum-Mechanical Description Be Considered Complete? Physical Review, 47(10), 777–780. DOI 10.1103/PhysRev.47.777',
		);
		expect(pieces.find((piece) => piece.style === 'italic')?.text).toBe('Physical Review');
		expect(pieces.find((piece) => piece.style === 'link')?.href).toBe(
			'https://doi.org/10.1103/PhysRev.47.777',
		);
	});

	it('shows a book’s title in italics, and its publisher', () => {
		const pieces = preview(
			'@book{knuth, author={Knuth, Donald E.}, title={The {\\TeX}book}, publisher={Addison-Wesley}, address={Reading}, year=1984}',
		);
		expect(pieces.map((piece) => piece.text).join('')).toBe(
			'Donald E. Knuth (1984). The TeXbook. Addison-Wesley, Reading.',
		);
		expect(pieces.find((piece) => piece.style === 'italic')?.text).toBe('The TeXbook');
	});

	it('never links what is not a web address', () => {
		const pieces = preview('@misc{a, title={T}, url={javascript:alert(1)}}');
		expect(pieces.some((piece) => piece.style === 'link')).toBe(false);
	});
});
