import {
	addEntryChanges,
	applyBibChanges,
	BIB_EDIT_ERRORS,
	BIB_ERRORS,
	BibEditError,
	changeTypeChanges,
	deleteEntryChanges,
	deleteFieldChanges,
	fieldText,
	findField,
	formatBibValue,
	parseBibDocument,
	renameKeyChanges,
	setFieldChanges,
} from '../../../src/utils/bibDocument';

const SAMPLE = `% A comment line BibTeX ignores
@string{ jcp = "J. Comput. Phys." }

@Article{ein05,
  author  = {Einstein, Albert},
  title   = "Zur Elektrodynamik bewegter K{\\"o}rper",
  journal = jcp # { (old)},
  year    = 1905,
  month   = jun,
}

@book(knuth84, title = {The {\\TeX}book}, publisher={Addison-Wesley}, year={1984})

@comment{jabref-meta: databaseType:biblatex;}
`;

const edit = (
	text: string,
	make: (entry: ReturnType<typeof parseBibDocument>['entries'][number]) => {
		from: number;
		to: number;
		insert: string;
	}[],
	index = 0,
) => applyBibChanges(text, make(parseBibDocument(text).entries[index]));

describe('parseBibDocument', () => {
	const doc = parseBibDocument(SAMPLE);

	it('reads entries, keys, types and fields where they are', () => {
		expect(doc.errors).toEqual([]);
		expect(doc.entries.map((entry) => [entry.type, entry.key])).toEqual([
			['Article', 'ein05'],
			['book', 'knuth84'],
		]);
		const [ein] = doc.entries;
		expect(SAMPLE.slice(ein.from, ein.to).startsWith('@Article{ein05')).toBe(
			true,
		);
		expect(SAMPLE.slice(ein.from, ein.to).endsWith('}')).toBe(true);
		expect(ein.fields.map((field) => [field.name, field.form])).toEqual([
			['author', 'braced'],
			['title', 'quoted'],
			['journal', 'expression'],
			['year', 'number'],
			['month', 'expression'],
		]);
		const title = findField(ein, 'TITLE');
		expect(title?.value).toBe('Zur Elektrodynamik bewegter K{\\"o}rper');
		expect(SAMPLE.slice(title!.valueFrom, title!.valueTo)).toBe(title!.raw);
	});

	it('reads (…) entries, macros and JabRef’s dialect mark', () => {
		const knuth = doc.entries[1];
		expect(findField(knuth, 'title')?.value).toBe('The {\\TeX}book');
		expect(knuth.close).not.toBeNull();
		expect(doc.strings.get('jcp')).toBe('J. Comput. Phys.');
		expect(fieldText(doc, findField(doc.entries[0], 'journal'))).toBe(
			'J. Comput. Phys. (old)',
		);
		expect(doc.jabrefDialect).toBe('biblatex');
	});

	it('goes on after an entry left open', () => {
		const text = `@article{a,\n  title = {One},\n\n@book{b,\n  title = {Two}\n}\n`;
		const broken = parseBibDocument(text);
		expect(broken.entries.map((entry) => entry.key)).toEqual(['a', 'b']);
		expect(broken.entries[0].error).toBe(BIB_ERRORS.unclosedEntry);
		expect(broken.entries[1].error).toBeUndefined();
	});

	it('goes on after an unclosed brace, at the next entry', () => {
		const text = `@article{a,\n  title = {One,\n\n@book{b,\n  title = {Two}\n}\n`;
		const broken = parseBibDocument(text);
		expect(broken.entries.map((entry) => entry.key)).toEqual(['a', 'b']);
		expect(broken.entries[0].error).toBe(BIB_ERRORS.unclosedValue);
		expect(findField(broken.entries[1], 'title')?.value).toBe('Two');
	});

	it('skips « % » comments between fields, and entries put aside with %', () => {
		const text = `%@article{old,\n%  title = {Old},\n%}\n@online{dejavu,\n  date = {2017}, % a remark, here\n%  urldate = {2017-03-18},\n  url = {https://a.b/%20c}\n}\n`;
		const read = parseBibDocument(text);
		expect(read.errors).toEqual([]);
		expect(read.entries.map((entry) => entry.key)).toEqual(['dejavu']);
		expect(read.entries[0].fields.map((field) => [field.name, field.value])).toEqual([
			['date', '2017'],
			['url', 'https://a.b/%20c'],
		]);
	});

	it('reports a field without « = »', () => {
		const broken = parseBibDocument('@misc{a, title {x}, year = 2000}');
		expect(broken.entries[0].error).toBe(BIB_ERRORS.missingEquals);
		expect(findField(broken.entries[0], 'year')?.value).toBe('2000');
	});
});

describe('field changes', () => {
	it('replaces only the value, in the form it had', () => {
		const result = edit(SAMPLE, (entry) =>
			setFieldChanges(SAMPLE, entry, 'title', 'New title'),
		);
		expect(result).toContain('  title   = "New title",\n');
		expect(result.replace('"New title"', '"Zur Elektrodynamik bewegter K{\\"o}rper"')).toBe(SAMPLE);
	});

	it('writes braces when quotes would not hold the value', () => {
		expect(formatBibValue('a "b" c', 'quoted')).toBe('{a "b" c}');
		expect(formatBibValue('1984', 'number')).toBe('1984');
		expect(formatBibValue('1984a', 'number')).toBe('{1984a}');
		expect(formatBibValue('jan # { 1}', 'expression')).toBe('jan # { 1}');
		expect(() => formatBibValue('a {b', 'braced')).toThrow(BibEditError);
		expect(() => formatBibValue('a b', 'expression')).toThrow(
			BIB_EDIT_ERRORS.invalidExpression,
		);
	});

	it('adds a field after the last one, aligned like the others', () => {
		const result = edit(SAMPLE, (entry) =>
			setFieldChanges(SAMPLE, entry, 'doi', '10.1002/andp.19053221004'),
		);
		expect(result).toContain(
			'  month   = jun,\n  doi     = {10.1002/andp.19053221004},\n}',
		);
	});

	it('adds a field to an entry on one line', () => {
		const result = edit(
			SAMPLE,
			(entry) => setFieldChanges(SAMPLE, entry, 'address', 'Reading'),
			1,
		);
		expect(result).toContain("year={1984}, address = {Reading})");
	});

	it('adds a comma after a last field without one', () => {
		const text = '@misc{a,\n\ttitle = {T}\n}\n';
		const result = edit(text, (entry) => setFieldChanges(text, entry, 'year', '2020'));
		expect(result).toBe('@misc{a,\n\ttitle = {T},\n\tyear = {2020}\n}\n');
	});

	it('adds the first field of an empty entry', () => {
		const open = '@misc{a,\n}\n';
		expect(edit(open, (entry) => setFieldChanges(open, entry, 'title', 'T'))).toBe(
			'@misc{a,\n  title = {T}\n}\n',
		);
		const closed = '@misc{a,}';
		expect(
			edit(closed, (entry) => setFieldChanges(closed, entry, 'title', 'T')),
		).toBe('@misc{a,\n  title = {T}\n}');
	});

	it('removes a field and its line', () => {
		const result = edit(SAMPLE, (entry) => deleteFieldChanges(SAMPLE, entry, 'year'));
		expect(result).toContain('jcp # { (old)},\n  month   = jun,\n}');
		const last = '@misc{a,\n  title = {T},\n  year = 2020\n}';
		expect(edit(last, (entry) => deleteFieldChanges(last, entry, 'year'))).toBe(
			'@misc{a,\n  title = {T},\n}',
		);
	});

	it('removes a field on a line with others', () => {
		const text = '@misc{a, title={T}, year=2020}';
		expect(edit(text, (entry) => deleteFieldChanges(text, entry, 'title'))).toBe(
			'@misc{a, year=2020}',
		);
		expect(edit(text, (entry) => deleteFieldChanges(text, entry, 'year'))).toBe(
			'@misc{a, title={T}}',
		);
	});

	it('removes a field given an empty value', () => {
		const result = edit(SAMPLE, (entry) => setFieldChanges(SAMPLE, entry, 'month', ''));
		expect(result).not.toContain('month');
	});

	it('refuses to change an entry it cannot read to its end', () => {
		const text = '@article{a,\n  title = {One},\n\n@book{b,\n  title = {Two}\n}\n';
		const [entry] = parseBibDocument(text).entries;
		expect(() => setFieldChanges(text, entry, 'title', 'x')).toThrow(
			BIB_EDIT_ERRORS.brokenEntry,
		);
	});
});

describe('entry changes', () => {
	it('renames the key, refusing what BibTeX stops at', () => {
		const [entry] = parseBibDocument(SAMPLE).entries;
		expect(applyBibChanges(SAMPLE, renameKeyChanges(entry, 'einstein1905'))).toContain(
			'@Article{einstein1905,',
		);
		expect(() => renameKeyChanges(entry, 'a b')).toThrow(BIB_EDIT_ERRORS.invalidKey);
		expect(() => renameKeyChanges(entry, ' ')).toThrow(BIB_EDIT_ERRORS.emptyKey);
	});

	it('changes the type in the case it was written in', () => {
		const [ein, knuth] = parseBibDocument(SAMPLE).entries;
		expect(changeTypeChanges(ein, 'inproceedings')[0].insert).toBe('Inproceedings');
		expect(changeTypeChanges(knuth, 'Manual')[0].insert).toBe('manual');
		const upper = parseBibDocument('@ARTICLE{a, title={T}}').entries[0];
		expect(changeTypeChanges(upper, 'book')[0].insert).toBe('BOOK');
	});

	it('removes an entry and the blank line after it, or before the last', () => {
		const text = '@misc{a,\n}\n\n@misc{b,\n}\n\n@misc{c,\n}\n';
		expect(edit(text, (entry) => deleteEntryChanges(text, entry), 1)).toBe(
			'@misc{a,\n}\n\n@misc{c,\n}\n',
		);
		expect(edit(text, (entry) => deleteEntryChanges(text, entry), 0)).toBe(
			'@misc{b,\n}\n\n@misc{c,\n}\n',
		);
		expect(edit(text, (entry) => deleteEntryChanges(text, entry), 2)).toBe(
			'@misc{a,\n}\n\n@misc{b,\n}\n',
		);
		const windows = '@misc{a,\r\n}\r\n\r\n@misc{b,\r\n}\r\n';
		expect(
			edit(windows, (entry) => deleteEntryChanges(windows, entry), 1),
		).toBe('@misc{a,\r\n}\r\n');
		expect(edit('@misc{a,\n}', (entry) => deleteEntryChanges('@misc{a,\n}', entry), 0)).toBe('');
	});

	it('adds an entry at the end, after a blank line', () => {
		expect(applyBibChanges('', addEntryChanges('', 'Article', 'k'))).toBe(
			'@article{k,\n}\n',
		);
		const text = '@misc{a,\n}\n\n\n';
		expect(applyBibChanges(text, addEntryChanges(text, 'book', 'b'))).toBe(
			'@misc{a,\n}\n\n@book{b,\n}\n',
		);
	});
});
