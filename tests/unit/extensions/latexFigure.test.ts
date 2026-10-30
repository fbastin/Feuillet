import {
	deleteFigure,
	findFigureAt,
	parseLatexFigure,
	setFigureImage,
	setFigureParts,
	setFigureWidth,
} from '@src/extensions/codemirror/visual/latexFigure';
import { applyChanges } from '@src/extensions/codemirror/visual/latexTable';

const FIGURE = [
	'Avant.',
	'\\begin{figure}[htbp]',
	'\t\\centering',
	'\t\\includegraphics[width=0.5\\linewidth]{images/plan.png}',
	'\t\\caption{Le plan}',
	'\t\\label{fig:plan}',
	'\\end{figure}',
	'Après.',
].join('\n');

const BARE = [
	'\\begin{figure}',
	'  \\includegraphics{photo}',
	'\\end{figure}',
].join('\n');

const at = (text: string) => {
	const figure = parseLatexFigure(text, text.indexOf('\\begin'));
	if (!figure) throw new Error('no figure');
	return figure;
};

describe('reading figures', () => {
	it('reads the image, its width, caption and label', () => {
		const figure = at(FIGURE);
		expect(figure.env).toBe('figure');
		expect(FIGURE.slice(figure.from, figure.to)).toMatch(
			/^\\begin\{figure\}[\s\S]*\\end\{figure\}$/,
		);
		expect(figure.graphics.path).toBe('images/plan.png');
		expect(figure.graphics.width).toBe(0.5);
		expect(figure.caption?.argument).toBe('Le plan');
		expect(figure.label?.argument).toBe('fig:plan');
		expect(figure.indent).toBe('\t');
	});

	it('reads a figure without options, caption or label', () => {
		const figure = at(BARE);
		expect(figure.graphics.path).toBe('photo');
		expect(figure.graphics.width).toBeNull();
		expect(figure.caption).toBeNull();
		expect(figure.label).toBeNull();
		expect(figure.indent).toBe('  ');
	});

	it('gives no width the line does not set', () => {
		const sized = (options: string) =>
			at(`\\begin{figure}\\includegraphics[${options}]{a}\\end{figure}`).graphics
				.width;
		expect(sized('width=\\textwidth')).toBe(1);
		expect(sized('width=5cm')).toBeNull();
		expect(sized('scale=0.4')).toBeNull();
		expect(sized('width=0.5\\linewidth,height=3cm')).toBeNull();
		expect(sized('angle=90, width=.3\\columnwidth')).toBe(0.3);
	});

	it('leaves figures it cannot edit, and commented LaTeX', () => {
		const two = '\\begin{figure}\\includegraphics{a}\\includegraphics{b}\\end{figure}';
		expect(parseLatexFigure(two, 0)).toBeNull();
		expect(parseLatexFigure('\\begin{figure}\\includegraphics{a}', 0)).toBeNull();
		expect(parseLatexFigure('\\begin{table}\\includegraphics{a}\\end{table}', 0)).toBeNull();
		const commented = [
			'\\begin{figure}',
			'% \\includegraphics{old}',
			'\\includegraphics{new} % \\caption{no}',
			'% \\end{figure}',
			'\\end{figure}',
		].join('\n');
		const figure = at(commented);
		expect(figure.graphics.path).toBe('new');
		expect(figure.caption).toBeNull();
		expect(figure.to).toBe(commented.length);
	});

	it('finds the figure around a position', () => {
		expect(findFigureAt(FIGURE, FIGURE.indexOf('plan.png'))?.from).toBe(
			FIGURE.indexOf('\\begin'),
		);
		expect(findFigureAt(FIGURE, FIGURE.indexOf('Après'))).toBeNull();
		expect(findFigureAt(FIGURE, 2)).toBeNull();
	});
});

describe('editing figures', () => {
	it('changes the width, keeping its unit', () => {
		const wider = applyChanges(FIGURE, setFigureWidth(FIGURE, at(FIGURE), 0.75));
		expect(wider).toContain('\\includegraphics[width=0.75\\linewidth]{images/plan.png}');
		const full = applyChanges(FIGURE, setFigureWidth(FIGURE, at(FIGURE), 1));
		expect(full).toContain('[width=\\linewidth]');
		const text = '\\begin{figure}\\includegraphics[width=0.8\\textwidth]{a}\\end{figure}';
		expect(applyChanges(text, setFigureWidth(text, at(text), 0.25))).toContain(
			'[width=0.25\\textwidth]',
		);
	});

	it('gives a width to an image without one', () => {
		expect(applyChanges(BARE, setFigureWidth(BARE, at(BARE), 0.5))).toContain(
			'\\includegraphics[width=0.5\\linewidth]{photo}',
		);
		const angle = '\\begin{figure}\\includegraphics[angle=90]{a}\\end{figure}';
		expect(applyChanges(angle, setFigureWidth(angle, at(angle), 0.5))).toContain(
			'[width=0.5\\linewidth, angle=90]',
		);
		const scaled = '\\begin{figure}\\includegraphics[scale=0.3, angle=90]{a}\\end{figure}';
		expect(applyChanges(scaled, setFigureWidth(scaled, at(scaled), 1))).toContain(
			'[width=\\linewidth, angle=90]',
		);
	});

	it('replaces the image', () => {
		expect(applyChanges(FIGURE, setFigureImage(at(FIGURE), 'images/carte.pdf'))).toContain(
			'[width=0.5\\linewidth]{images/carte.pdf}',
		);
	});

	it('removes the caption and the label with their lines', () => {
		const text = applyChanges(
			FIGURE,
			setFigureParts(FIGURE, at(FIGURE), { caption: null, label: null }),
		);
		expect(text).toBe(
			[
				'Avant.',
				'\\begin{figure}[htbp]',
				'\t\\centering',
				'\t\\includegraphics[width=0.5\\linewidth]{images/plan.png}',
				'\\end{figure}',
				'Après.',
			].join('\n'),
		);
		const noLabel = applyChanges(
			FIGURE,
			setFigureParts(FIGURE, at(FIGURE), { caption: 'x', label: null }),
		);
		expect(noLabel).toContain('\t\\caption{Le plan}\n\\end{figure}');
		expect(
			setFigureParts(FIGURE, at(FIGURE), { caption: 'x', label: 'fig:x' }),
		).toEqual([]);
	});

	it('adds a caption after the image, and the label after the caption', () => {
		const both = applyChanges(
			BARE,
			setFigureParts(BARE, at(BARE), { caption: 'Titre', label: 'fig:photo' }),
		);
		expect(both).toBe(
			[
				'\\begin{figure}',
				'  \\includegraphics{photo}',
				'  \\caption{Titre}',
				'  \\label{fig:photo}',
				'\\end{figure}',
			].join('\n'),
		);
		const noLabel = applyChanges(
			FIGURE,
			setFigureParts(FIGURE, at(FIGURE), { caption: 'x', label: null }),
		);
		const label = applyChanges(
			noLabel,
			setFigureParts(noLabel, at(noLabel), { caption: 'x', label: 'fig:plan' }),
		);
		expect(label).toBe(FIGURE);
	});

	it('handles a caption and a label on one line', () => {
		const text = '\\begin{figure}\n\\includegraphics{a}\n\\caption{A}\\label{fig:a}\n\\end{figure}';
		expect(
			applyChanges(text, setFigureParts(text, at(text), { caption: null, label: null })),
		).toBe('\\begin{figure}\n\\includegraphics{a}\n\\end{figure}');
		expect(
			applyChanges(text, setFigureParts(text, at(text), { caption: 'A', label: null })),
		).toContain('\n\\caption{A}\n\\end');
		const inside = '\\begin{figure}\n\\includegraphics{a}\n\\caption{A\\label{fig:a}}\n\\end{figure}';
		expect(
			applyChanges(inside, setFigureParts(inside, at(inside), { caption: null, label: 'fig:a' })),
		).toBe('\\begin{figure}\n\\includegraphics{a}\n\\label{fig:a}\n\\end{figure}');
	});

	it('deletes a figure with its lines', () => {
		expect(applyChanges(FIGURE, [deleteFigure(FIGURE, at(FIGURE))])).toBe(
			'Avant.\nAprès.',
		);
		expect(applyChanges(BARE, [deleteFigure(BARE, at(BARE))])).toBe('');
		const inline = 'a \\begin{figure}\\includegraphics{x}\\end{figure} b';
		expect(applyChanges(inline, [deleteFigure(inline, at(inline))])).toBe('a  b');
	});
});
