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

import fr from '../../../../translations/locales/fr.json';

jest.mock('@/i18n', () => ({
	t: (key: string) => (fr as Record<string, string>)[key] ?? key,
}));

// The LaTeX package is an ES module only: its short lists.
jest.mock('codemirror-lang-latex', () => ({
	latexPackages: ['amsmath', 'geometry', 'tikz', 'hyperref'],
	documentClasses: ['article', 'beamer'],
}));

const projectFiles = [
	{ type: 'file', name: 'main.tex', path: '/main.tex' },
	{ type: 'file', name: 'mymacros.sty', path: '/styles/mymacros.sty' },
	{ type: 'file', name: 'old.sty', path: '/old.sty', isDeleted: true },
	{ type: 'file', name: 'mythesis.cls', path: '/mythesis.cls' },
	{ type: 'file', name: 'monstyle.bst', path: '/monstyle.bst' },
	{
		type: 'file',
		name: 'beamerthemeFeuillet.sty',
		path: '/theme/beamerthemeFeuillet.sty',
	},
	{ type: 'directory', name: 'styles', path: '/styles' },
];
jest.mock('@src/services/FilePathCacheService', () => ({
	filePathCacheService: {
		getCachedFiles: async () => projectFiles,
		flattenFiles: (files: unknown[]) => files,
		toCompileRelativePath: (path: string) => path.replace(/^\/+/, ''),
	},
}));

import {
	texLiveNameArgument,
	withTexLiveNames,
} from '@src/extensions/codemirror/autocomplete/texLiveNamesCompletion';

// What the LaTeX completion answers elsewhere.
const fallback = (context: CompletionContext) => ({
	from: context.pos,
	options: [{ label: 'fallback' }],
});

let view: EditorView;
const complete = async (doc: string): Promise<readonly Completion[]> => {
	view?.destroy();
	view = new EditorView({
		state: EditorState.create({
			doc,
			selection: EditorSelection.cursor(doc.length),
			extensions: [
				autocompletion({
					override: [withTexLiveNames(fallback)],
					activateOnTypingDelay: 0,
				}),
			],
		}),
		parent: document.body,
	});
	startCompletion(view);
	for (let i = 0; i < 100 && completionStatus(view.state) !== 'active'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return currentCompletions(view.state);
};
const option = (options: readonly Completion[], label: string) =>
	options.find((candidate) => candidate.label === label);

afterAll(() => view?.destroy());

describe('the argument under the cursor', () => {
	it('finds the package being typed, after the options and in a list', () => {
		expect(texLiveNameArgument('\\usepackage{geo')).toMatchObject({
			kind: 'sty',
			typed: 'geo',
		});
		expect(texLiveNameArgument('\\usepackage[utf8]{inp')).toMatchObject({
			kind: 'sty',
			typed: 'inp',
		});
		expect(texLiveNameArgument('\\usepackage{amsmath, geo')).toMatchObject({
			typed: 'geo',
		});
		expect(
			texLiveNameArgument('\\usepackage{\n  amsmath, % maths\n  amssy'),
		).toMatchObject({ typed: 'amssy' });
		expect(texLiveNameArgument('\\RequirePackage{xcol')).toMatchObject({
			kind: 'sty',
		});
	});

	it('finds classes, BibTeX styles and Beamer themes', () => {
		expect(texLiveNameArgument('\\documentclass[12pt]{art')).toMatchObject({
			kind: 'cls',
			typed: 'art',
		});
		expect(texLiveNameArgument('\\bibliographystyle{pl')).toMatchObject({
			kind: 'bst',
			typed: 'pl',
		});
		expect(texLiveNameArgument('\\usetheme{Mad')).toMatchObject({
			themePrefix: 'beamertheme',
		});
		expect(texLiveNameArgument('\\usecolortheme{')).toMatchObject({
			themePrefix: 'beamercolortheme',
			typed: '',
		});
	});

	it('stays out of options, comments, closed braces and other commands', () => {
		expect(texLiveNameArgument('\\usepackage[ut')).toBeNull();
		expect(texLiveNameArgument('% \\usepackage{geo')).toBeNull();
		expect(texLiveNameArgument('\\usepackage{amsmath} geo')).toBeNull();
		expect(texLiveNameArgument('\\documentclass{article,rep')).toBeNull();
		expect(texLiveNameArgument('\\input{geo')).toBeNull();
		expect(texLiveNameArgument('\\usepackageX{geo')).toBeNull();
	});
});

describe('the completion', () => {
	it('offers all of TeX Live, the common names first', async () => {
		const options = await complete('\\usepackage{');
		expect(options.length).toBeGreaterThan(6000);
		const geometry = option(await complete('\\usepackage{geo'), 'geometry');
		expect(geometry).toMatchObject({
			info: 'Flexible and complete interface to document dimensions',
		});
		expect(geometry?.detail).toBeUndefined();
		expect(geometry?.boost).toBe(2);
	});

	it('names the TeX Live package a file belongs to, and its engine', async () => {
		expect(option(await complete('\\usepackage{tik'), 'tikz')).toMatchObject({
			detail: 'pgf',
			info: 'Create PostScript and PDF graphics in TeX',
		});
		expect(
			option(await complete('\\usepackage{luacod'), 'luacode'),
		).toMatchObject({ detail: 'LuaLaTeX' });
		expect(option(await complete('\\usepackage{xeCJ'), 'xeCJK')).toMatchObject(
			{ detail: 'XeLaTeX', info: 'Typeset CJK in XeLaTeX' },
		);
	});

	it("puts the project's own files first, by their path", async () => {
		const options = await complete('\\usepackage{amsmath,mym');
		expect(option(options, 'styles/mymacros')).toMatchObject({
			detail: 'dans ce projet',
			boost: 3,
		});
		expect(option(options, 'old')).toBeUndefined();
		expect(
			option(await complete('\\documentclass{myth'), 'mythesis'),
		).toMatchObject({ detail: 'dans ce projet' });
		expect(
			option(await complete('\\bibliographystyle{mon'), 'monstyle'),
		).toBeDefined();
	});

	it('completes classes, BibTeX styles and Beamer themes', async () => {
		expect(
			option(await complete('\\documentclass{IEEE'), 'IEEEtran'),
		).toMatchObject({
			info: 'Document class for IEEE Transactions journals and conferences',
		});
		expect(
			option(await complete('\\bibliographystyle{splncs'), 'splncs04'),
		).toMatchObject({ detail: 'llncs' });
		const themes = await complete('\\usetheme{');
		expect(option(themes, 'Madrid')).toMatchObject({ detail: 'beamer' });
		expect(option(themes, 'Feuillet')).toMatchObject({
			detail: 'dans ce projet',
		});
		expect(option(themes, 'beamerthemeMadrid')).toBeUndefined();
		expect(
			option(await complete('\\usecolortheme{'), 'beaver'),
		).toBeDefined();
	});

	it('leaves everything else to the LaTeX completion', async () => {
		expect((await complete('\\sec')).map((o) => o.label)).toEqual([
			'fallback',
		]);
		expect((await complete('\\usepackage[ut')).map((o) => o.label)).toEqual([
			'fallback',
		]);
		// Not its short list either, in a comment.
		expect(await complete('% \\usepackage{geo')).toEqual([]);
	});
});
