import {
	createStarterFile,
	createTemplateFiles,
	fillTemplate,
	templateLanguageFor,
} from '@src/utils/projectStarterUtils';

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

describe('templates', () => {
	it('writes the blank project in French when asked', () => {
		const content = createStarterFile('latex', 'Mémoire', 'Ada', 'fr')
			?.content as string;
		expect(content).toContain('\\usepackage[french]{babel}');
		expect(content).toContain('\\usepackage[T1]{fontenc}');
		expect(content).toContain('\\title{Mémoire}');
		expect(
			createStarterFile('typst', 'Mémoire', 'Ada', 'fr')?.content,
		).toContain('#set text(lang: "fr")');
	});

	it('fills in the title and the names, escaped', () => {
		expect(
			fillTemplate(
				'\\title{{{TITLE}}} \\author{{{AUTHOR}}} \\name{{{FIRST_NAME}}}{{{LAST_NAME}}}',
				{ title: 'R&D 100%', author: '  Marie Curie-Skłodowska ' },
			),
		).toBe(
			'\\title{R\\&D 100\\%} \\author{Marie Curie-Skłodowska} \\name{Marie}{Curie-Skłodowska}',
		);
		expect(
			fillTemplate('\\name{{{FIRST_NAME}}}{{{LAST_NAME}}}', {
				title: '',
				author: 'Jean de La Fontaine',
			}),
		).toBe('\\name{Jean de La}{Fontaine}');
		expect(
			fillTemplate('\\name{{{FIRST_NAME}}}{{{LAST_NAME}}}', {
				title: '',
				author: 'ada',
			}),
		).toBe('\\name{ada}{}');
		// Other double braces are LaTeX.
		expect(
			fillTemplate('\\newcommand{\\x}{{a}} {{OTHER}}', {
				title: 'T',
				author: 'A',
			}),
		).toBe('\\newcommand{\\x}{{a}} {{OTHER}}');
	});

	it('makes the folders, fills only LaTeX files and keeps images as they are', () => {
		const image = Uint8Array.from([137, 80, 78, 71]).buffer;
		const files = createTemplateFiles(
			[
				{ path: '/main.tex', content: '\\title{{{TITLE}}}' },
				{ path: '/chapters/one/intro.tex', content: '{{AUTHOR}}' },
				{ path: '/references.bib', content: '{{TITLE}}' },
				{ path: '/images/plot.png', content: image },
			],
			{ title: 'Thèse', author: 'Ada' },
		);
		expect(files.map((file) => `${file.type} ${file.path}`)).toEqual([
			'directory /chapters',
			'directory /chapters/one',
			'directory /images',
			'file /chapters/one/intro.tex',
			'file /images/plot.png',
			'file /main.tex',
			'file /references.bib',
		]);
		const byPath = Object.fromEntries(files.map((file) => [file.path, file]));
		expect(byPath['/main.tex'].content).toBe('\\title{Thèse}');
		expect(byPath['/chapters/one/intro.tex'].content).toBe('Ada');
		expect(byPath['/chapters/one/intro.tex'].name).toBe('intro.tex');
		expect(byPath['/references.bib'].content).toBe('{{TITLE}}');
		expect(byPath['/images/plot.png']).toMatchObject({
			content: image,
			isBinary: true,
			size: 4,
			mimeType: 'image/png',
		});
		// In bytes, as stored.
		expect(byPath['/main.tex'].size).toBe(14);
	});

	it('picks the language of the interface', () => {
		expect(templateLanguageFor('fr')).toBe('fr');
		expect(templateLanguageFor('fr-CA')).toBe('fr');
		expect(templateLanguageFor('en')).toBe('en');
		expect(templateLanguageFor('de')).toBe('en');
	});
});
