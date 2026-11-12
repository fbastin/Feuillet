import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
	figureImageName,
	figureLabel,
	figureLatex,
	insertFigure,
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

describe('the name of an image fetched from elsewhere', () => {
	const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0]).buffer;

	it('keeps an image name as it is', () => {
		expect(figureImageName('plan.PNG', bytes(1))).toBe('plan.PNG');
	});

	it('takes the extension from the content when the name has none', () => {
		expect(figureImageName('image', bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image.png');
		expect(figureImageName('photo.php', bytes(0xff, 0xd8, 0xff))).toBe('photo.jpg');
		expect(figureImageName('figure', bytes(0x25, 0x50, 0x44, 0x46))).toBe('figure.pdf');
		expect(figureImageName('', bytes(0x25, 0x21, 0x50, 0x53))).toBe('image.eps');
	});

	it('none for what LaTeX cannot include', () => {
		expect(figureImageName('page.html', new TextEncoder().encode('<html>').buffer)).toBeNull();
	});
});

describe('where a figure goes', () => {
	const place = (doc: string, at: number) => {
		const view = new EditorView({
			state: EditorState.create({ doc, selection: { anchor: at } }),
			parent: document.body,
		});
		insertFigure(view, 'FIG');
		const result = view.state.doc.toString();
		view.destroy();
		return result;
	};

	it('on a blank line, in its place', () => {
		expect(place('a\n\nb', 2)).toBe('a\nFIG\nb');
	});

	it('after the line the cursor is in', () => {
		expect(place('Some text.\n\\end{document}', 4)).toBe(
			'Some text.\nFIG\n\\end{document}',
		);
	});

	it('before the line the cursor starts, as \\end{document}', () => {
		expect(place('Some text.\n\\end{document}', 11)).toBe(
			'Some text.\nFIG\n\\end{document}',
		);
		expect(place('x\n  \\end{document}', 4)).toBe('x\nFIG\n  \\end{document}');
	});
});
