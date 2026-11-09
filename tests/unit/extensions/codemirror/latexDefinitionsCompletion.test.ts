import {
	autocompletion,
	completionStatus,
	currentCompletions,
	nextSnippetField,
	startCompletion,
} from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import fr from '../../../../translations/locales/fr.json';

jest.mock('@/i18n', () => ({
	t: (key: string, options: Record<string, string> = {}) =>
		((fr as Record<string, string>)[key] ?? key).replace(
			/\{\{(\w+)\}\}/g,
			(_, name) => options[name] ?? '',
		),
}));

// The LaTeX package is an ES module only: the names it already knows.
jest.mock('codemirror-lang-latex', () => ({
	commandIndex: new Map([['\\section', {}]]),
	symbolIndex: new Map([['\\alpha', {}]]),
	environmentIndex: new Map([['itemize', {}]]),
}));

// What the project's other files define.
const others = new Map<string, unknown>();
jest.mock('@src/services/FilePathCacheService', () => ({
	filePathCacheService: { getTexDefinitions: () => others },
}));

import { latexDefinitionsCompletion } from '@src/extensions/codemirror/autocomplete/latexDefinitionsCompletion';
import { findLatexDefinitions } from '@src/utils/latexDefinitions';

const PREAMBLE = String.raw`\documentclass{article}
\newcommand{\R}{\mathbb{R}}
\newcommand{\norme}[1]{\lVert #1 \rVert}
\renewcommand{\section}{}
\newtheorem{lemme}{Lemme}
\begin{document}
`;

let view: EditorView;
const make = (doc: string) => {
	view = new EditorView({
		state: EditorState.create({
			doc,
			selection: EditorSelection.cursor(doc.length),
			extensions: [
				autocompletion({
					override: [latexDefinitionsCompletion('/chapitres/intro.tex')],
					activateOnTypingDelay: 0,
				}),
			],
		}),
		parent: document.body,
	});
};
const complete = async () => {
	startCompletion(view);
	for (let i = 0; i < 50 && completionStatus(view.state) !== 'active'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return currentCompletions(view.state);
};
const pick = (label: string) => {
	const option = currentCompletions(view.state).find((o) => o.label === label)!;
	const { from } = view.state.selection.main;
	const start = view.state.doc.toString().lastIndexOf(
		label.startsWith('\\') ? '\\' : '{',
		from,
	) + (label.startsWith('\\') ? 0 : 1);
	if (typeof option.apply === 'function') option.apply(view, option, start, from);
	else view.dispatch({ changes: { from: start, to: from, insert: option.apply ?? label } });
};

afterEach(() => {
	view?.destroy();
	others.clear();
});

describe('the project\'s commands in the autocompletion', () => {
	it('offers this file\'s commands as typed, not the ones LaTeX knows', async () => {
		make(`${PREAMBLE}On a \\`);
		const options = await complete();
		expect(options.map((o) => o.label).sort()).toEqual(['\\R', '\\norme']);
		expect(options.find((o) => o.label === '\\R')?.detail).toBe(
			'défini dans intro.tex',
		);
	});

	it('and the other files\', named after their file', async () => {
		others.set('/macros.sty', findLatexDefinitions(String.raw`\DeclareMathOperator{\Tr}{Tr}`));
		make(`${PREAMBLE}On a \\T`);
		const options = await complete();
		expect(options.find((o) => o.label === '\\Tr')?.detail).toBe('défini dans macros.sty');
	});

	it('puts a field in each pair of braces', async () => {
		make(`${PREAMBLE}On a $\\no`);
		await complete();
		pick('\\norme');
		const doc = view.state.doc.toString();
		expect(doc.endsWith('$\\norme{}')).toBe(true);
		expect(view.state.selection.main.head).toBe(doc.length - 1);
		// Tab leaves the braces.
		expect(nextSnippetField(view)).toBe(true);
		expect(view.state.selection.main.head).toBe(doc.length);
	});

	it('offers the theorems after \\begin{, closed with \\end', async () => {
		make(`${PREAMBLE}\\begin{le`);
		const options = await complete();
		expect(options.map((o) => o.label)).toEqual(['lemme']);
		pick('lemme');
		// The tab of the template is the editor's indentation.
		expect(view.state.doc.toString().endsWith('\\begin{lemme}\n  \n\\end{lemme}')).toBe(true);
		expect(view.state.selection.main.head).toBe(view.state.doc.length - '\n\\end{lemme}'.length);
	});

	it('offers nothing when the project defines nothing', async () => {
		make('\\documentclass{article}\n\\begin{document}\n\\sec');
		expect(await complete()).toEqual([]);
	});
});
