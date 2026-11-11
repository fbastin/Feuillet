import {
	autocompletion,
	type Completion,
	completionStatus,
	currentCompletions,
	nextSnippetField,
	startCompletion,
} from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// The LaTeX package is an ES module only: the names it already completes.
jest.mock('codemirror-lang-latex', () => ({
	commandIndex: new Map([['\\section', {}]]),
	symbolIndex: new Map([['\\alpha', {}]]),
	environmentIndex: new Map([
		['itemize', {}],
		['align', {}],
		['alignat', {}],
	]),
}));

// What the project's other files load.
const others = new Map<string, { packages: string[] }>();
jest.mock('@src/services/FilePathCacheService', () => ({
	filePathCacheService: { getTexDefinitions: () => others },
}));

import {
	packageCommandsCompletion,
	parseWordListLine,
	wordListsFor,
} from '@src/extensions/codemirror/autocomplete/packageCommandsCompletion';
import { findLatexDefinitions } from '@src/utils/latexDefinitions';

describe('a word list line', () => {
	it('gives a command with a field per argument, then a stop after', () => {
		expect(parseWordListLine('\\qty{number}{unit%specialMultiArg}')).toEqual({
			kind: 'command',
			name: '\\qty',
			display: '\\qty{number}{unit}',
			template: '\\qty{${1:number}}{${2:unit}}${}',
		});
		expect(parseWordListLine('\\ang[%<options%>]{%<angle%>}')).toMatchObject({
			display: '\\ang[options]{angle}',
			template: '\\ang[${1:options}]{${2:angle}}${}',
		});
	});

	it('keeps two arguments of the same name apart, and plain names plain', () => {
		expect(parseWordListLine('\\pair{x}{x}')?.template).toBe(
			'\\pair{${1:x}}{${2:x}}${}',
		);
		expect(parseWordListLine('\\hfill')).toMatchObject({
			display: '\\hfill',
			template: null,
		});
	});

	it('puts the cursor where %| says, LaTeX text kept as it is', () => {
		expect(parseWordListLine('\\left(%|\\right)')).toMatchObject({
			display: '\\left(\\right)',
			template: '\\left(${}\\right)',
		});
		expect(parseWordListLine('\\left\\{%|\\right\\}')?.template).toBe(
			'\\left\\\\{${}\\right\\\\}',
		);
	});

	it('gives environments, with their arguments and what goes inside', () => {
		expect(parseWordListLine('\\begin{alignat}{ncols}')).toEqual({
			kind: 'environment',
			name: 'alignat',
			display: 'alignat{ncols}',
			template: 'alignat}{${1:ncols}}\n\t${}\n\\end{alignat}',
		});
		expect(parseWordListLine('\\begin{description}\\item')?.template).toBe(
			'description}\n\t\\item ${}\n\\end{description}',
		);
	});
});

describe('what a file loads', () => {
	it('names TeXstudio word lists: packages, classes, libraries, themes', () => {
		expect(
			findLatexDefinitions(String.raw`\documentclass[11pt]{memoir}
\usepackage[utf8]{inputenc}
\usepackage{amsmath, siunitx}
% \usepackage{commented}
\usetikzlibrary{arrows.meta,positioning}
\tcbuselibrary{skins}
\usetheme{Madrid}
\RequirePackage{xcolor}`).packages,
		).toEqual([
			'class-memoir',
			'inputenc',
			'amsmath',
			'siunitx',
			'tikzlibraryarrows.meta',
			'tikzlibrarypositioning',
			'tcolorboxlibraryskins',
			'beamerthemeMadrid',
			'xcolor',
		]);
	});

	it('follows includes and class aliases', async () => {
		const lists = await wordListsFor(['class-article', 'siunitx']);
		expect(lists).toEqual(
			expect.arrayContaining(['latex-document', 'tex', 'siunitx', 'array']),
		);
		expect(lists).not.toContain('class-article');
		const beamer = await wordListsFor(['class-beamer']);
		expect(beamer).toContain('beamerbaselocalstructure');
	});
});

describe('the completion', () => {
	let view: EditorView;
	const complete = async (doc: string): Promise<readonly Completion[]> => {
		view?.destroy();
		view = new EditorView({
			state: EditorState.create({
				doc,
				selection: EditorSelection.cursor(doc.length),
				extensions: [
					autocompletion({
						override: [packageCommandsCompletion()],
						activateOnTypingDelay: 0,
					}),
				],
			}),
			parent: document.body,
		});
		startCompletion(view);
		for (let i = 0; i < 200 && completionStatus(view.state) !== 'active'; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		return currentCompletions(view.state);
	};
	const shown = (options: readonly Completion[]) =>
		options.map((option) => `${option.displayLabel} · ${option.detail}`);
	afterAll(() => view?.destroy());
	afterEach(() => others.clear());

	it("offers the commands of the packages the file loads", async () => {
		const options = await complete(
			'\\documentclass{article}\n\\usepackage{siunitx}\n\\begin{document}\n\\qt',
		);
		const forms = shown(options).filter((s) => s.startsWith('\\qty{') || s.startsWith('\\qty['));
		// The plain form first.
		expect(forms).toEqual([
			'\\qty{number}{unit} · siunitx',
			'\\qty[options]{number}{unit} · siunitx',
		]);
	});

	it('not those of packages it does not load', async () => {
		const options = await complete('\\documentclass{article}\n\\qt');
		expect(shown(options).some((s) => s.startsWith('\\qty'))).toBe(false);
	});

	it("nor those LaTeX's own completion already gives", async () => {
		const options = await complete('\\documentclass{article}\n\\sec');
		expect(options.some((option) => option.label === '\\section')).toBe(false);
	});

	it('inserts the arguments as fields, the first selected', async () => {
		const options = await complete('\\usepackage{siunitx}\n\\qt');
		const qty = options.find((option) => option.displayLabel === '\\qty{number}{unit}');
		expect(qty).toBeDefined();
		const { from } = view.state.selection.main;
		const start = view.state.doc.toString().lastIndexOf('\\');
		(qty?.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(
			view,
			qty as Completion,
			start,
			from,
		);
		const doc = view.state.doc.toString();
		expect(doc.endsWith('\\qty{number}{unit}')).toBe(true);
		const selection = view.state.selection.main;
		expect(doc.slice(selection.from, selection.to)).toBe('number');
	});

	it('Tab goes from one field to the next, then after the command', async () => {
		// Typed right before \\end{document}, on the same line.
		const doc = '\\usepackage{siunitx}\nx \\qt\\end{document}';
		view?.destroy();
		view = new EditorView({
			state: EditorState.create({
				doc,
				selection: EditorSelection.cursor(doc.indexOf('\\end')),
				extensions: [autocompletion({ override: [packageCommandsCompletion()] })],
			}),
			parent: document.body,
		});
		startCompletion(view);
		for (let i = 0; i < 200 && completionStatus(view.state) !== 'active'; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		const qty = currentCompletions(view.state).find(
			(option) => option.displayLabel === '\\qty{number}{unit}',
		) as Completion;
		const at = view.state.selection.main.head;
		(qty.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(
			view,
			qty,
			at - 3,
			at,
		);
		const typeHere = (text: string) =>
			view.dispatch(view.state.replaceSelection(text));
		typeHere('3');
		nextSnippetField(view);
		typeHere('m');
		nextSnippetField(view);
		typeHere('.');
		expect(view.state.doc.toString()).toBe(
			'\\usepackage{siunitx}\nx \\qty{3}{m}.\\end{document}',
		);
	});

	it("offers the class's commands, through its includes, named after it", async () => {
		const options = await complete('\\documentclass{beamer}\n\\frameti');
		// TeXstudio has it in beamerbaselocalstructure, which beamer includes.
		expect(shown(options)).toContain('\\frametitle{title} · beamer');
	});

	it("and those of packages another file of the project loads", async () => {
		others.set('/preambule.tex', { packages: ['siunitx'] });
		const options = await complete('\\documentclass{article}\n\\qt');
		expect(shown(options)).toContain('\\qty{number}{unit} · siunitx');
	});

	it('offers their environments after \\begin{', async () => {
		const options = await complete('\\usepackage{amsmath}\n\\begin{ali');
		expect(shown(options)).toEqual(
			expect.arrayContaining(['align* · amsmath', 'alignat{ncols} · amsmath']),
		);
		expect(options.some((option) => option.label === 'itemize')).toBe(false);
		// LaTeX's own completion has align: kept here with arguments only.
		expect(shown(options)).not.toContain('align · amsmath');
	});
});
