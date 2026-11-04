import {
	annotate,
	hasWords,
	latexReading,
	paragraphsAround,
	typstReading,
} from '@src/utils/grammarText';

// The places of `pieces` in `source`, as prose.
const proseOf = (source: string, ...pieces: string[]) => {
	let at = 0;
	return pieces.map((piece) => {
		const from = source.indexOf(piece, at);
		at = from + piece.length;
		return { from, to: at };
	});
};
const joined = (parts: ReturnType<typeof annotate>) =>
	parts.map((part) => part.text ?? part.markup).join('');
const read = (parts: ReturnType<typeof annotate>) =>
	parts.map((part) => part.text ?? part.interpretAs).join('');

describe('LaTeX as LanguageTool reads it', () => {
	it('keeps the paragraph whole, so that places are the document’s', () => {
		const source = 'La valeur $x$ est \\emph{très} grande, voir~\\ref{fig}.';
		const parts = annotate(source, proseOf(source, 'La valeur ', ' est ', 'très', ' grande, voir~', '.'), 'latex');
		expect(joined(parts)).toBe(source);
		expect(read(parts)).toBe('La valeur x est très grande, voir 1.');
	});

	it('reads TeX quotes, ties and dashes as they print', () => {
		const source = "Il dit ``oui'' --- pages 1--3.";
		const parts = annotate(source, [{ from: 0, to: source.length }], 'latex');
		expect(joined(parts)).toBe(source);
		expect(read(parts)).toBe('Il dit "oui" — pages 1–3.');
	});

	it('reads markup by what it does', () => {
		expect(latexReading('\n\\item ')).toBe('\n\n- ');
		expect(latexReading('\\section{')).toBe('\n\n');
		expect(latexReading('}\n\\begin{itemize}\n')).toBe('\n\n');
		expect(latexReading('\\begin{equation}a=b\\end{equation}')).toBe('x');
		expect(latexReading('$\\alpha$')).toBe('x');
		expect(latexReading('\\cite[p.~3]{knuth}')).toBe('[1]');
		expect(latexReading('\\citep{a,b}')).toBe('[1]');
		expect(latexReading('\\eqref{eq:1}')).toBe('1');
		expect(latexReading('\\LaTeX{}')).toBe('LaTeX');
		expect(latexReading('\\og ')).toBe('« ');
		expect(latexReading('% un commentaire\n')).toBe(' ');
		expect(latexReading('\\textbf{')).toBe('');
		expect(latexReading('\n\n')).toBe('\n\n');
	});

	it('merges markup that reads as nothing', () => {
		const source = '\\textbf{\\emph{Mot}}';
		const parts = annotate(source, proseOf(source, 'Mot'), 'latex');
		expect(parts).toEqual([
			{ markup: '\\textbf{\\emph{', interpretAs: '' },
			{ text: 'Mot' },
			{ markup: '}}', interpretAs: '' },
		]);
	});
});

describe('Typst as LanguageTool reads it', () => {
	it('reads headings, lists, formulas and references', () => {
		expect(typstReading('\n- ')).toBe('\n\n- ');
		expect(typstReading('= ')).toBe('\n\n');
		expect(typstReading('$x + y$')).toBe('x');
		expect(typstReading('@fig')).toBe('1');
		expect(typstReading('\n')).toBe(' ');
		expect(typstReading('*')).toBe('');
		const source = 'Voir @fig et $x$.';
		const parts = annotate(source, proseOf(source, 'Voir ', ' et ', '.'), 'typst');
		expect(joined(parts)).toBe(source);
		expect(read(parts)).toBe('Voir 1 et x.');
	});
});

describe('paragraphs', () => {
	const text = 'Un.\nDeux.\n\nTrois.\n  \nQuatre.\n\n\nCinq.';
	const slices = (ranges: Array<{ from: number; to: number }>) => ranges.map(({ from, to }) => text.slice(from, to));

	it('are between blank lines, even with spaces', () => {
		expect(slices(paragraphsAround(text, 0, text.length))).toEqual(['Un.\nDeux.', 'Trois.', 'Quatre.', 'Cinq.']);
	});

	it('only those a range touches', () => {
		const at = text.indexOf('Trois');
		expect(slices(paragraphsAround(text, at, at + 3))).toEqual(['Trois.']);
	});

	it('cut at a line’s end when too long', () => {
		const long = 'aaaa\nbbbb\ncccc';
		expect(paragraphsAround(long, 0, long.length, 10).map(({ from, to }) => long.slice(from, to))).toEqual(['aaaa\nbbbb', '\ncccc']);
	});

	it('tell those with words', () => {
		expect(hasWords([{ markup: '$x$', interpretAs: 'x' }, { text: ' ' }])).toBe(false);
		expect(hasWords([{ text: 'Un mot' }])).toBe(true);
	});
});
