import { forEachDiagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

import {
	compileDiagnosticsField,
	createCompileDiagnosticsExtension,
} from '@src/extensions/codemirror/CompileDiagnosticsExtension';
import { compileDiagnosticsService } from '@src/services/CompileDiagnosticsService';

jest.mock('@/i18n', () => ({ t: (key: string) => key }));

const mockParse = jest.fn();
jest.mock('@src/plugins/PluginRegistry', () => ({
	pluginRegistry: {
		getLoggerForType: (logType: string) =>
			logType === 'latex' ? { parseDiagnostics: mockParse } : null,
	},
}));

const mockFiles: Record<string, { id: string; documentId?: string; path: string }> = {
	'main.tex': { id: 'file-main', documentId: 'doc-main', path: '/main.tex' },
	'intro.tex': { id: 'file-intro', path: '/chapters/intro.tex' },
};
jest.mock('@src/services/FilePathCacheService', () => ({
	filePathCacheService: {
		findFileByPath: async (_fromPath: string, candidate: string) =>
			mockFiles[candidate.split('/').pop() ?? ''] ?? null,
	},
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let views: EditorView[] = [];

const createView = (doc: string, documentId = 'doc-main') => {
	const view = new EditorView({
		state: EditorState.create({
			doc,
			extensions: [lineNumbers(), createCompileDiagnosticsExtension({ documentId })],
		}),
		parent: document.body,
	});
	views.push(view);
	return view;
};

const lintedLines = (view: EditorView) => {
	const lines: number[] = [];
	forEachDiagnostic(view.state, (_diagnostic, from) => {
		lines.push(view.state.doc.lineAt(from).number);
	});
	return lines;
};

afterEach(async () => {
	for (const view of views) view.destroy();
	views = [];
	mockParse.mockReset();
	compileDiagnosticsService.clear();
	await tick();
});

describe('compileDiagnosticsService', () => {
	it('ties each diagnostic with a line to its project file', async () => {
		mockParse.mockReturnValue([
			{ type: 'error', message: 'Undefined control sequence.', line: 4, file: 'main.tex' },
			{ type: 'error', message: 'Environment ended', line: 2, file: 'intro.tex' },
			{ type: 'warning', message: 'Overfull hbox', line: 7 },
			{ type: 'warning', message: 'From a package', line: 10, file: 'article.cls' },
			{ type: 'warning', message: 'Undefined references detected' },
		]);

		await compileDiagnosticsService.publish('latex', 'log', '/main.tex');

		expect(
			compileDiagnosticsService
				.getForTarget({ documentId: 'doc-main' })
				.map(({ line, severity }) => [line, severity]),
		).toEqual([
			[4, 'error'],
			[7, 'warning'],
		]);
		expect(
			compileDiagnosticsService.getForTarget({ fileId: 'file-intro' }),
		).toEqual([
			{ fileId: 'file-intro', line: 2, severity: 'error', message: 'Environment ended' },
		]);
		expect(compileDiagnosticsService.getForTarget({})).toEqual([]);
	});

	it('keeps the latest compile when an earlier one finishes last', async () => {
		mockParse
			.mockReturnValueOnce(
				Array.from({ length: 20 }, (_, i) => ({
					type: 'error',
					message: `old ${i}`,
					line: i + 1,
					file: 'main.tex',
				})),
			)
			.mockReturnValueOnce([
				{ type: 'error', message: 'new', line: 3, file: 'main.tex' },
			]);

		await Promise.all([
			compileDiagnosticsService.publish('latex', 'first', '/main.tex'),
			compileDiagnosticsService.publish('latex', 'second', '/main.tex'),
		]);

		expect(
			compileDiagnosticsService
				.getForTarget({ documentId: 'doc-main' })
				.map((entry) => entry.message),
		).toEqual(['new']);
	});

	it('clears the diagnostics when no logger reads the log', async () => {
		mockParse.mockReturnValue([
			{ type: 'error', message: 'x', line: 1, file: 'main.tex' },
		]);
		await compileDiagnosticsService.publish('latex', 'log', '/main.tex');
		await compileDiagnosticsService.publish('other', 'log', '/main.tex');

		expect(compileDiagnosticsService.getForTarget({ documentId: 'doc-main' })).toEqual([]);
	});
});

describe('createCompileDiagnosticsExtension', () => {
	it('marks the reported lines and keeps them on their text while editing', async () => {
		mockParse.mockReturnValue([
			{ type: 'error', message: 'Undefined control sequence.', line: 3, file: 'main.tex' },
			{ type: 'warning', message: 'Overfull hbox', line: 4, file: 'main.tex' },
		]);
		await compileDiagnosticsService.publish('latex', 'log', '/main.tex');

		const view = createView('a\nb\n  \\bad\nlong line\n');
		await tick();

		const [error] = view.state.field(compileDiagnosticsField);
		expect(view.state.sliceDoc(error.from, error.to)).toBe('\\bad');
		expect(error.source).toBe('Compile log');
		expect(lintedLines(view)).toEqual([3, 4]);
		expect(
			view.dom.querySelector('.cm-lineNumbers .cm-compile-error-line')?.textContent,
		).toBe('3');
		expect(
			view.dom.querySelector('.cm-lineNumbers .cm-compile-warning-line')?.textContent,
		).toBe('4');

		view.dispatch({ changes: { from: 0, insert: 'new\n' } });
		await tick();

		const [moved] = view.state.field(compileDiagnosticsField);
		expect(view.state.sliceDoc(moved.from, moved.to)).toBe('\\bad');
		expect(view.state.doc.lineAt(moved.from).number).toBe(4);
	});

	it('leaves other files alone', async () => {
		mockParse.mockReturnValue([
			{ type: 'error', message: 'x', line: 1, file: 'intro.tex' },
		]);
		await compileDiagnosticsService.publish('latex', 'log', '/main.tex');

		const view = createView('a\nb\n');
		await tick();

		expect(view.state.field(compileDiagnosticsField)).toEqual([]);
		expect(lintedLines(view)).toEqual([]);
	});

	it('waits for the content of a shared document', async () => {
		mockParse.mockReturnValue([
			{ type: 'error', message: 'x', line: 2, file: 'main.tex' },
		]);
		await compileDiagnosticsService.publish('latex', 'log', '/main.tex');

		const view = createView('');
		await tick();
		expect(view.state.field(compileDiagnosticsField)).toEqual([]);

		view.dispatch({ changes: { from: 0, insert: 'first\nsecond\n' } });
		await tick();

		expect(lintedLines(view)).toEqual([2]);
	});

	it('replaces the marks with those of the next compile', async () => {
		mockParse.mockReturnValueOnce([
			{ type: 'error', message: 'x', line: 1, file: 'main.tex' },
		]);
		await compileDiagnosticsService.publish('latex', 'log', '/main.tex');
		const view = createView('a\nb\n');
		await tick();
		expect(lintedLines(view)).toEqual([1]);

		mockParse.mockReturnValueOnce([]);
		await compileDiagnosticsService.publish('latex', 'fixed', '/main.tex');
		await tick();

		expect(view.state.field(compileDiagnosticsField)).toEqual([]);
		expect(lintedLines(view)).toEqual([]);
		expect(view.dom.querySelector('.cm-compile-error-line')).toBeNull();
	});
});
