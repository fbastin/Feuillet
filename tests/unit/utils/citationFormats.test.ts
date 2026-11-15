import { applyBibChanges } from '@/utils/bibDocument';
import {
	citationFormatOf,
	scanMarkdownCitations,
	scanTypstCitations,
} from '@/utils/citationFormats';
import {
	collectCitations,
	renameCitationChanges,
} from '@/utils/latexCitations';

describe('citationFormatOf', () => {
	it('reads LaTeX, Typst and Markdown documents', () => {
		expect(citationFormatOf('/main.tex')).toBe('latex');
		expect(citationFormatOf('/paper.typ')).toBe('typst');
		expect(citationFormatOf('/notes.md')).toBe('markdown');
		expect(citationFormatOf('/report.qmd')).toBe('markdown');
		expect(citationFormatOf('/refs.bib')).toBeNull();
	});
});

describe('Typst', () => {
	const TEXT = [
		'= Introduction <intro>',
		'As @knuth1984 shows, and #cite(<lamport1994>, supplement: [p. 3]).',
		'See @intro, @fig:plot and #cite("old2001"). Write to alice@example.org.',
		'// @commented',
		'/* @blocked */ `@raw` ```typ @rawblock``` $ @math $ \\@escaped',
		'#figure(image("a.png"), caption: [A plot]) <fig:plot>',
		'#bibliography("refs.bib", full: true)',
	].join('\n');

	it('reads @key and cite(), and tells references and labels', () => {
		const scan = scanTypstCitations(TEXT);
		expect(scan.citations.map((citation) => citation.key)).toEqual([
			'knuth1984',
			'lamport1994',
			'intro',
			'fig:plot',
			'old2001',
		]);
		for (const citation of scan.citations) {
			expect(TEXT.slice(citation.from, citation.to)).toBe(citation.key);
		}
		expect(scan.labels).toEqual(['intro', 'fig:plot']);
		expect(scan.everything).toBe(true);
	});

	it('takes a reference to a label of the project for no citation', () => {
		const citations = collectCitations([
			{ path: '/main.typ', text: TEXT, format: 'typst' },
			{ path: '/part.typ', text: 'Back to @intro and @appendix.', format: 'typst' },
			{ path: '/appendix.typ', text: '= Appendix <appendix>', format: 'typst' },
		]);
		expect([...citations.cited.keys()].sort()).toEqual([
			'knuth1984',
			'lamport1994',
			'old2001',
		]);
		expect(citations.everything).toEqual(['/main.typ']);
	});

	it('finds none in a string of code', () => {
		expect(
			scanTypstCitations(
				'#let tests = (\n  "with @import",\n  "and \\"@quoted\\""\n)\nAs @knuth1984 said "see @lamport".',
			).citations.map((citation) => citation.key),
		).toEqual(['knuth1984', 'lamport']);
	});

	it('ends a key before a final period or colon', () => {
		expect(
			scanTypstCitations('Shown in @knuth1984. And @a.b:c: too').citations.map(
				(citation) => citation.key,
			),
		).toEqual(['knuth1984', 'a.b:c']);
	});

	it('renames the citations, not a label’s references', () => {
		const text = '@knuth #cite(<knuth>) and @intro <intro>';
		expect(
			applyBibChanges(text, renameCitationChanges(text, 'knuth', 'knuth1984', 'typst')),
		).toBe('@knuth1984 #cite(<knuth1984>) and @intro <intro>');
		expect(renameCitationChanges(text, 'intro', 'x', 'typst')).toEqual([]);
	});
});

describe('Markdown', () => {
	it('reads Pandoc’s citations, and its front matter’s nocite', () => {
		const text = [
			'---',
			'title: A paper',
			'bibliography: refs.bib',
			'nocite: |',
			'  @extra2020, @{odd:key}',
			'---',
			'',
			'As [@knuth1984, p. 33; see @lamport1994] and @doe2020 say,',
			'[-@smith2021] agrees. See @fig-plot and @sec:intro.',
			'Mail alice@example.org. `@code` \\@escaped',
			'<!-- @hidden -->',
			'```',
			'@fenced',
			'```',
			'The key @{weird key/2020}.',
		].join('\n');
		const scan = scanMarkdownCitations(text);
		expect(scan?.citations.map((citation) => citation.key)).toEqual([
			'extra2020',
			'odd:key',
			'knuth1984',
			'lamport1994',
			'doe2020',
			'smith2021',
			'weird key/2020',
		]);
		for (const citation of scan?.citations ?? []) {
			expect(text.slice(citation.from, citation.to)).toBe(citation.key);
		}
	});

	it('tells @* in nocite', () => {
		expect(
			scanMarkdownCitations("---\nbibliography: refs.bib\nnocite: '@*'\n---\nText.")
				?.everything,
		).toBe(true);
	});

	it('reads no file that is no Pandoc document with citations', () => {
		// A CHANGELOG's mentions.
		expect(
			scanMarkdownCitations('# Changes\n\nThanks to @alice and @bob for 2.0.'),
		).toBeNull();
		// Nor one that shows a citation as code.
		expect(scanMarkdownCitations('Write `[@key, p. 3]` to cite.')).toBeNull();
		// Citations in brackets are enough.
		expect(
			scanMarkdownCitations('Shown by [@knuth1984].')?.citations.map((c) => c.key),
		).toEqual(['knuth1984']);
	});

	it('renames a key where it is cited, braces kept', () => {
		const text = '---\nbibliography: refs.bib\n---\n[@old; @{old}] and @older.';
		expect(
			applyBibChanges(text, renameCitationChanges(text, 'old', 'new', 'markdown')),
		).toBe('---\nbibliography: refs.bib\n---\n[@new; @{new}] and @older.');
	});
});
