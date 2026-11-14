import { applyBibChanges } from '@/utils/bibDocument';
import {
	collectCitations,
	isCitationCommand,
	renameCitationChanges,
	scanCitations,
} from '@/utils/latexCitations';

const keys = (text: string) =>
	scanCitations(text)
		.citations.filter((citation) => !citation.commented)
		.map((citation) => citation.key);

describe('scanCitations', () => {
	it('reads the keys of \\cite and its kin, where they are written', () => {
		const text = 'As in \\cite{knuth1984, lamport1994} and \\citep[p.~3]{doe2020}.';
		const scan = scanCitations(text);
		expect(scan.citations.map((citation) => citation.key)).toEqual([
			'knuth1984',
			'lamport1994',
			'doe2020',
		]);
		for (const citation of scan.citations) {
			expect(text.slice(citation.from, citation.to)).toBe(citation.key);
		}
	});

	it('knows natbib, biblatex, apacite and one’s own commands', () => {
		expect(
			keys(
				[
					'\\citet{a} \\citealp*{b} \\citeauthor{c} \\Citeyear{d}',
					'\\parencite[see][12]{e} \\textcite{f} \\autocite*{g}',
					'\\footcite{h} \\fullcite{i} \\citeA{j} \\citeNP{k}',
					'\\defcitealias{l}{Paper I} \\citetalias{l} \\bibentry{m}',
					'\\mycite{n} \\nocite{o}',
				].join('\n'),
			),
		).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'l', 'm', 'n', 'o']);
	});

	it('reads every key of \\cites and the volume citations', () => {
		expect(
			keys('\\cites(all)(){a}[see][1]{b}{c} and \\parencites[12]{d}[3]{e} f'),
		).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(keys('\\volcite[see]{2}[45]{knuth} \\pvolcite{1}{lamport}')).toEqual([
			'knuth',
			'lamport',
		]);
	});

	it('leaves settings and definitions', () => {
		for (const name of [
			'citestyle',
			'setcitestyle',
			'DeclareCiteCommand',
			'newcommand',
			'citeindextrue',
			'bibpunct',
			'citetext',
		]) {
			expect(isCitationCommand(name)).toBe(false);
		}
		expect(keys('\\setcitestyle{authoryear} \\citestyle{plain}')).toEqual([]);
		// A macro's argument is no key.
		expect(keys('\\newcommand{\\mine}[1]{\\cite{#1}} \\citetext{priv. comm.}')).toEqual(
			[],
		);
		expect(keys('\\mancite and so on')).toEqual([]);
	});

	it('tells what a comment holds', () => {
		const scan = scanCitations('\\cite{a} % \\cite{b}\n\\cite{c} 50\\% \\cite{d}');
		expect(
			scan.citations.map((citation) => [citation.key, citation.commented]),
		).toEqual([
			['a', false],
			['b', true],
			['c', false],
			['d', false],
		]);
	});

	it('reads arguments across a line, not a blank one', () => {
		expect(keys('\\citep[p.~3]\n  {a,\n   b}')).toEqual(['a', 'b']);
		expect(keys('\\cite\n\n{a}')).toEqual([]);
	});

	it('finds no citation in verbatim text or \\verb', () => {
		expect(
			keys(
				'\\begin{verbatim}\n\\cite{a}\n\\end{verbatim}\n\\verb|\\cite{b}| \\cite{c}\n\\begin{lstlisting}\\cite{d}\\end{lstlisting}',
			),
		).toEqual(['c']);
	});

	it('reads \\nocite{*}, \\bibitem and a .bib in filecontents', () => {
		const scan = scanCitations(
			[
				'\\nocite{*}',
				'\\begin{filecontents}[overwrite]{refs.bib}',
				'@article{inline2020, title = {T}}',
				'\\end{filecontents}',
				'\\begin{thebibliography}{9}',
				'\\bibitem[Knuth(1984)]{knuth1984} D. Knuth.',
				'\\end{thebibliography}',
			].join('\n'),
		);
		expect(scan.everything).toBe(true);
		expect(scan.defined).toEqual(['inline2020', 'knuth1984']);
		expect(scan.citations).toEqual([]);
	});

	it('reads through the review’s annotation tags', () => {
		const text =
			"See <### comment id: 'c1', user: Ann, time: 1, content: '50%' ###>\\cite{a}</### comment id: c1 ###>.";
		const scan = scanCitations(text);
		expect(scan.citations).toHaveLength(1);
		expect(scan.citations[0].commented).toBe(false);
		expect(text.slice(scan.citations[0].from, scan.citations[0].to)).toBe('a');
	});
});

describe('renameCitationChanges', () => {
	it('renames the key where it is cited, and only there', () => {
		const text =
			'\\cite{knuth84,lamport} \\citep[p.~3]{ knuth84 } % \\cite{knuth84}\n\\label{knuth84} \\cite{knuth84a}';
		const renamed = applyBibChanges(
			text,
			renameCitationChanges(text, 'knuth84', 'knuth1984'),
		);
		expect(renamed).toBe(
			'\\cite{knuth1984,lamport} \\citep[p.~3]{ knuth1984 } % \\cite{knuth1984}\n\\label{knuth84} \\cite{knuth84a}',
		);
	});
});

describe('collectCitations', () => {
	it('counts each key’s citations per file, not those in comments', () => {
		const citations = collectCitations(
			[
				{ path: '/main.tex', text: '\\cite{a,b} \\cite{a} % \\cite{c}' },
				{ path: '/intro.tex', text: '\\cite{a} \\nocite{*}' },
			],
			['other2020'],
		);
		expect(citations.cited.get('a')).toEqual({
			count: 3,
			files: [
				{ path: '/main.tex', count: 2 },
				{ path: '/intro.tex', count: 1 },
			],
		});
		expect(citations.cited.has('c')).toBe(false);
		expect(citations.everything).toEqual(['/intro.tex']);
		expect(citations.defined.has('other2020')).toBe(true);
		expect(citations.files).toEqual(['/main.tex', '/intro.tex']);
	});
});
