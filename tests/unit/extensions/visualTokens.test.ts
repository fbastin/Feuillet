import {
	matchBrace,
	plainText,
	scanVisualTokens,
	type VisualToken,
} from '@src/extensions/codemirror/visual/visualTokens';

const of = <K extends VisualToken['kind']>(
	tokens: VisualToken[],
	kind: K,
): Extract<VisualToken, { kind: K }>[] =>
	tokens.filter((token): token is Extract<VisualToken, { kind: K }> => token.kind === kind);

const DOC = [
	'\\documentclass{article}',
	'\\title{Une \\emph{belle} thèse}',
	'\\author{Ana \\and Bea}',
	'\\begin{document}',
	'\\maketitle',
	'\\section{Introduction}',
	'Du \\textbf{gras}, de l\'\\emph{italique} et 50\\,\\% de $x^2$. % note',
	'\\begin{itemize}',
	'  \\item Premier',
	'  \\item Second',
	'\\end{itemize}',
	'\\begin{enumerate}',
	'\\item Un',
	'\\item Deux',
	'\\end{enumerate}',
	'\\begin{equation}',
	'  E = mc^2 \\label{eq:e}',
	'\\end{equation}',
	'Voir~\\eqref{eq:e} et \\cite{knuth, lamport}.',
	'\\includegraphics[width=0.5\\textwidth]{figures/plan}',
	'\\href{https://example.org}{le site}',
	'\\end{document}',
].join('\n');

describe('scanVisualTokens', () => {
	const tokens = scanVisualTokens(DOC);
	const text = (from: number, to: number) => DOC.slice(from, to);

	it('folds the preamble', () => {
		const [preamble] = of(tokens, 'preamble');
		expect(preamble.from).toBe(0);
		expect(text(preamble.from, preamble.to)).toBe(
			DOC.slice(0, DOC.indexOf('\\begin{document}') + '\\begin{document}'.length),
		);
		expect(preamble.lines).toBe(3);
	});

	it('hides the document environment lines', () => {
		const hidden = of(tokens, 'hiddenLine').map((token) => text(token.from, token.to));
		expect(hidden).not.toContain('\n\\begin{document}');
		expect(hidden).toContain('\n\\end{document}');
		expect(hidden).toContain('\n\\begin{itemize}');
	});

	it('shows the title from the preamble', () => {
		const [title] = of(tokens, 'title');
		expect(title).toMatchObject({ title: 'Une belle thèse', author: 'Ana, Bea' });
	});

	it('finds headings and the markup around them', () => {
		const [heading] = of(tokens, 'heading');
		expect(heading.level).toBe(1);
		expect(text(heading.open.from, heading.open.to)).toBe('\\section{');
		expect(text(heading.open.to, heading.close.from)).toBe('Introduction');
		expect(text(heading.close.from, heading.close.to)).toBe('}');
	});

	it('finds emphasis, nested in what holds it', () => {
		const styles = of(tokens, 'format').map((token) => [
			token.style,
			text(token.open.to, token.close.from),
		]);
		expect(styles).toEqual(
			expect.arrayContaining([
				['italic', 'belle'],
				['bold', 'gras'],
				['italic', 'italique'],
			]),
		);
	});

	it('marks list items with bullets or numbers', () => {
		expect(of(tokens, 'item').map((item) => item.marker)).toEqual([
			'•',
			'•',
			'1.',
			'2.',
		]);
	});

	it('finds formulas, inline and displayed, without their labels', () => {
		const math = of(tokens, 'math');
		expect(math.map((token) => [token.tex, token.display])).toEqual([
			['x^2', false],
			['E = mc^2', true],
		]);
	});

	it('turns references and citations into chips', () => {
		expect(of(tokens, 'chip').map((chip) => [chip.style, chip.text])).toEqual([
			['ref', 'eq:e'],
			['cite', 'knuth, lamport'],
		]);
	});

	it('finds escapes, comments, images and links', () => {
		expect(of(tokens, 'escape').map((token) => token.text)).toEqual(['\u2009', '%', '\u00a0']);
		expect(of(tokens, 'comment').map((token) => text(token.from, token.to))).toEqual([
			'% note',
		]);
		expect(of(tokens, 'image')[0].path).toBe('figures/plan');
		const [link] = of(tokens, 'link');
		expect(text(link.open.to, link.close.from)).toBe('le site');
		expect(text(link.open.from, link.open.to)).toBe('\\href{https://example.org}{');
	});

	it('shows ties and small spaces as spaces', () => {
		const spaces = of(scanVisualTokens('Voir~1 et 50\\,\\% puis a\\!b'), 'escape');
		expect(spaces.map((token) => token.text)).toEqual(['\u00a0', '\u2009', '%', '']);
	});

	it('leaves unfinished markup alone', () => {
		const broken = scanVisualTokens('\\textbf{sans fin et $x');
		expect(of(broken, 'format')).toEqual([]);
		expect(of(broken, 'math')).toEqual([]);
	});

	it('does not let an inline formula cross a paragraph', () => {
		expect(of(scanVisualTokens('Prix : 5 $\n\nPuis 6 $ encore'), 'math')).toEqual([]);
	});
});

describe('helpers', () => {
	it('matches nested braces, ignoring escaped ones', () => {
		const text = '\\textbf{a {b} \\} c}d';
		expect(text.slice(matchBrace(text, 7))).toBe('}d');
	});

	it('reads short arguments as plain text', () => {
		expect(plainText('Ana\\thanks{Merci} \\and Bea~Smith')).toBe('Ana, Bea Smith');
	});
});
