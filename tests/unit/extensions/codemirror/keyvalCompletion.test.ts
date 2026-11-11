import {
	autocompletion,
	type Completion,
	type CompletionContext,
	completionStatus,
	currentCompletions,
	startCompletion,
} from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

jest.mock('@/i18n', () => ({ t: (key: string) => key }));

// The LaTeX package is an ES module only: what the modules here use of it.
jest.mock('codemirror-lang-latex', () => ({
	commandIndex: new Map(),
	symbolIndex: new Map(),
	environmentIndex: new Map(),
	latexPackages: [],
	documentClasses: [],
}));

// What the project's other files load.
const others = new Map<string, { packages: string[] }>();
jest.mock('@src/services/FilePathCacheService', () => ({
	filePathCacheService: { getTexDefinitions: () => others },
}));

import {
	keyvalCompletion,
	keyvalContext,
	parseKeyval,
	withoutBundledOptions,
} from '@src/extensions/codemirror/autocomplete/keyvalCompletion';

// The cursor at |.
const at = (text: string) => keyvalContext(text.replace('|', ''), text.indexOf('|'));

describe('where options are typed', () => {
	it('in a command’s optional argument, a key being typed', () => {
		expect(at('\\includegraphics[width=2cm, he|]{a.png}')).toMatchObject({
			command: '\\includegraphics',
			args: '[',
			key: null,
			from: 28,
			typed: 'he',
		});
	});

	it('a value after =, its key named', () => {
		expect(at('\\captionsetup[figure]{labelfont = b|}')).toMatchObject({
			command: '\\captionsetup',
			args: '[{',
			key: 'labelfont',
			typed: 'b',
		});
	});

	it('an environment’s options, and a package’s with its name after', () => {
		expect(at('\\begin{tcolorbox}[colback=red,\n  col|]')).toMatchObject({
			command: '\\begin{tcolorbox}',
			args: '[',
			typed: 'col',
		});
		expect(at('\\usepackage[margin=2cm,|]{geometry, xcolor}')).toMatchObject({
			command: '\\usepackage',
			names: ['geometry', 'xcolor'],
			typed: '',
		});
		// No ] yet: none is added before a {.
		expect(at('\\usepackage[marg|{geometry}\n\\begin{document}[x]')).toMatchObject({
			names: ['geometry'],
			typed: 'marg',
		});
	});

	it('not in a comment, a command, a value’s braces, coordinates or text', () => {
		expect(at('% \\includegraphics[wi|]')).toBeNull();
		expect(at('\\includegraphics[width=0.5\\text|]')).toBeNull();
		expect(at('\\includegraphics[alt={A pic|}]')).toBeNull();
		expect(at('\\draw[->] (0,|')).toBeNull();
		expect(at('Some text [wi|]')).toBeNull();
		expect(at('\\begin{ite|}')).toBeNull();
		expect(at('\\\\[2|]')).toBeNull();
	});
});

describe('a key as TeXstudio writes it', () => {
	it('with a placeholder for its value', () => {
		expect(parseKeyval('width=##L')).toEqual({
			key: 'width',
			display: 'width=length',
			values: [],
			template: 'width=${1:length}',
			insert: 'width=',
		});
		expect(parseKeyval('alt={%<alt text%>}')).toMatchObject({
			display: 'alt={alt text}',
			template: 'alt={${1:alt text}}',
		});
	});

	it('with its values; true or false: the key alone', () => {
		expect(parseKeyval('pagebox=#mediabox,cropbox')).toMatchObject({
			insert: 'pagebox=',
			values: ['mediabox', 'cropbox'],
		});
		expect(parseKeyval('clip#true,false')).toMatchObject({
			display: 'clip',
			insert: 'clip',
			values: ['true', 'false'],
		});
		expect(parseKeyval('colback=#%color')?.values).toContain('red');
		expect(parseKeyval('quiet')).toMatchObject({ insert: 'quiet', template: null });
	});
});

describe('the completion', () => {
	let view: EditorView;
	const open = async (text: string): Promise<readonly Completion[]> => {
		view?.destroy();
		const doc = text.replace('|', '');
		view = new EditorView({
			state: EditorState.create({
				doc,
				selection: EditorSelection.cursor(text.indexOf('|')),
				extensions: [
					autocompletion({
						override: [keyvalCompletion()],
						activateOnTypingDelay: 0,
					}),
				],
			}),
			parent: document.body,
		});
		startCompletion(view);
		for (let i = 0; i < 300 && completionStatus(view.state) !== 'active'; i++) {
			if (i > 0 && completionStatus(view.state) === null) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		return currentCompletions(view.state);
	};
	const shown = (options: readonly Completion[]) =>
		options.map((option) => `${option.displayLabel ?? option.label} · ${option.detail}`);
	afterAll(() => view?.destroy());
	afterEach(() => others.clear());

	it("offers \\includegraphics's keys, with graphicx", async () => {
		const options = await open(
			'\\documentclass{article}\n\\usepackage{graphicx}\n\\includegraphics[|]{a.png}',
		);
		expect(shown(options)).toEqual(
			expect.arrayContaining(['width=length · graphicx', 'keepaspectratio · graphicx']),
		);
	});

	it('not in its file name, nor without the package', async () => {
		expect(
			await open('\\usepackage{graphicx}\n\\includegraphics[width=2cm]{a|}'),
		).toEqual([]);
		expect(await open('\\documentclass{article}\n\\includegraphics[wi|]')).toEqual([]);
	});

	it("a package's options, by the name after them", async () => {
		const options = await open('\\documentclass{article}\n\\usepackage[|]{geometry}');
		expect(shown(options)).toEqual(
			expect.arrayContaining(['margin=length · geometry', 'paper= · geometry']),
		);
	});

	it("the class's options; the standard ones for a class it does not know", async () => {
		expect(shown(await open('\\documentclass[a4|]{article}'))).toContain(
			'a4paper · LaTeX',
		);
		expect(shown(await open('\\documentclass[twoc|]{mythesis}'))).toContain(
			'twocolumn · LaTeX',
		);
	});

	it('in the argument that takes them: \\captionsetup[figure]{…}', async () => {
		const options = await open(
			'\\usepackage{caption}\n\\captionsetup[figure]{label|}',
		);
		// TeXstudio has them in caption3, named after caption, which is loaded.
		expect(shown(options)).toContain('labelfont= · caption');
		expect(await open('\\usepackage{caption}\n\\captionsetup[fig|]{}')).toEqual([]);
	});

	it('keys loaded by another file of the project count too', async () => {
		others.set('/preamble.tex', { packages: ['tcolorbox'] });
		const options = await open('\\begin{tcolorbox}[colb|]');
		expect(options.some((option) => option.label === 'colback')).toBe(true);
	});

	it('values after =, then picking a key opens its values', async () => {
		const values = await open('\\usepackage[paper=|]{geometry}');
		expect(values.map((option) => option.label)).toContain('a4paper');

		const keys = await open('\\usepackage[pap|]{geometry}');
		const paper = keys.find((option) => option.label === 'paper') as Completion;
		const end = view.state.selection.main.head;
		(paper.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(
			view,
			paper,
			end - 3,
			end,
		);
		expect(view.state.doc.toString()).toBe('\\usepackage[paper=]{geometry}');
		for (let i = 0; i < 300 && completionStatus(view.state) !== 'active'; i++)
			await new Promise((resolve) => setTimeout(resolve, 10));
		expect(currentCompletions(view.state).map((option) => option.label)).toContain(
			'a4paper',
		);
	});
});

describe("the LaTeX package's own option lists", () => {
	// Its source asks these, in this order, as completeOptions does.
	const bundled = (context: CompletionContext) =>
		context.matchBefore(/\\includegraphics\[[^\]]*$/)
			? { from: context.pos, options: [{ label: 'width' }] }
			: context.matchBefore(/\\([a-zA-Z]*)$/)
				? { from: context.pos, options: [{ label: '\\textwidth' }] }
				: null;

	it('give way to the keys, and its commands work inside options again', () => {
		const contextAt = (doc: string) =>
			({
				state: EditorState.create({ doc }),
				pos: doc.length,
				explicit: false,
				matchBefore(expression: RegExp) {
					const match = new RegExp(`(?:${expression.source})$`).exec(doc);
					return match ? { from: match.index, to: doc.length, text: match[0] } : null;
				},
			}) as unknown as CompletionContext;
		const source = withoutBundledOptions(bundled);
		expect(source(contextAt('\\includegraphics[wi'))).toBeNull();
		expect(
			(source(contextAt('\\includegraphics[width=0.5\\textw')) as { options: Completion[] })
				.options[0].label,
		).toBe('\\textwidth');
	});
});
