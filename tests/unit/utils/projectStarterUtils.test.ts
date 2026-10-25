import { createStarterFile } from '@src/utils/projectStarterUtils';

describe('createStarterFile', () => {
	it('creates an Overleaf-style main.tex with escaped title and author', () => {
		const file = createStarterFile('latex', 'Costs & Benefits_v2', 'Ada #1');

		expect(file).toEqual(
			expect.objectContaining({
				name: 'main.tex',
				path: '/main.tex',
				type: 'file',
				isBinary: false,
			}),
		);
		const content = file?.content as string;
		expect(content).toContain('\\documentclass{article}');
		expect(content).toContain('\\title{Costs \\& Benefits\\_v2}');
		expect(content).toContain('\\author{Ada \\#1}');
		expect(content).toContain('\\section{Introduction}');
		expect(content.trimEnd().endsWith('\\end{document}')).toBe(true);
	});

	it('creates a main.typ with quoted strings for Typst projects', () => {
		const file = createStarterFile('typst', 'A "quoted" title', 'Ada');

		expect(file?.path).toBe('/main.typ');
		expect(file?.content).toContain(
			'#set document(title: "A \\"quoted\\" title", author: "Ada")',
		);
		expect(file?.content).toContain('= Introduction');
	});

	it('has no starter for other typesetters', () => {
		expect(createStarterFile('sile', 'Doc', 'Ada')).toBeNull();
	});
});
