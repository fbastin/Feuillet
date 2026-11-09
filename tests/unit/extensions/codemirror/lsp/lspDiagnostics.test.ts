import { linter } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { createLSPDiagnosticsExtension } from '@src/extensions/codemirror/lsp/lspDiagnostics';

jest.mock('@src/services/GenericLSPService', () => ({
	genericLSPService: {
		onDiagnostics: () => () => {},
		getConfigName: () => undefined,
	},
}));

// The editor's linters share one delay, the longest given. The LSP
// diagnostics' linter gave 0, so the code check read the whole file at every
// key: it must leave the others' delay as it is.
describe('LSP diagnostics linter', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('does not make the other linters run at every key', () => {
		const check = jest.fn(() => []);
		const view = new EditorView({
			state: EditorState.create({
				doc: 'Texte.',
				extensions: [linter(check), createLSPDiagnosticsExtension('main.tex')],
			}),
			parent: document.body,
		});
		jest.advanceTimersByTime(1000);
		check.mockClear();

		view.dispatch({ changes: { from: 0, insert: 'a' } });
		jest.advanceTimersByTime(100);
		view.dispatch({ changes: { from: 1, insert: 'b' } });
		jest.advanceTimersByTime(100);
		expect(check).not.toHaveBeenCalled();

		jest.advanceTimersByTime(1000);
		expect(check).toHaveBeenCalledTimes(1);
		view.destroy();
	});
});
