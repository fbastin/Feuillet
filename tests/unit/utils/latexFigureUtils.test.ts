import {
	figureLabel,
	figureLatex,
	isFigureImage,
} from '@src/utils/latexFigureUtils';

describe('figures, as Overleaf inserts them', () => {
	it('writes a centred figure with its caption and label', () => {
		const { text, caption } = figureLatex({
			path: 'images/plan.png',
			width: 0.5,
			caption: 'Saisissez la légende',
			label: 'fig:plan',
		});
		expect(text).toBe(
			[
				'\\begin{figure}',
				'\t\\centering',
				'\t\\includegraphics[width=0.5\\linewidth]{images/plan.png}',
				'\t\\caption{Saisissez la légende}',
				'\t\\label{fig:plan}',
				'\\end{figure}',
			].join('\n'),
		);
		expect(caption && text.slice(caption.from, caption.to)).toBe('Saisissez la légende');
	});

	it('leaves out what is not asked for', () => {
		const { text, caption } = figureLatex({ path: 'a.pdf', width: 1, caption: null, label: null });
		expect(text).toBe('\\begin{figure}\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{a.pdf}\n\\end{figure}');
		expect(caption).toBeUndefined();
	});

	it('names labels after the image', () => {
		expect(figureLabel('images/Plan du Été.PNG')).toBe('fig:plan-du-ete');
		expect(figureLabel('---.png')).toBe('fig:figure');
	});

	it('knows the images LaTeX can include', () => {
		expect(['a.png', 'b.JPG', 'c.jpeg', 'd.pdf', 'e.eps'].every(isFigureImage)).toBe(true);
		expect(['f.svg', 'g.gif', 'h.tex', 'png'].some(isFigureImage)).toBe(false);
	});
});
