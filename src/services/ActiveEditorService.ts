// src/services/ActiveEditorService.ts
// The editor last opened or focused, for what acts on its text from
// elsewhere: the command palette inserts, goes to a line, comments,
// formats, saves and compiles there as the editor's own keys do.
import type { EditorView } from '@codemirror/view';

import type { ToolbarController } from '../extensions/codemirror/ToolbarExtension';

export interface ActiveEditor {
	view: EditorView;
	/** The kind of file: latex, typst, bib, markdown… */
	fileType: string;
	/** Its toolbar's tools, while the toolbar is shown. */
	toolbar: () => ToolbarController | null;
	/** Saves the open file, then compiles, as Ctrl+Enter does. */
	saveAndCompile: () => void;
	/** Formats the file, as Ctrl+Shift+I does; false when it cannot. */
	format: () => boolean;
	/** Whether one may comment here. */
	comments: boolean;
}

let current: ActiveEditor | null = null;

export const activeEditorService = {
	set(editor: ActiveEditor): void {
		current = editor;
	},
	/** Forgets `view`, when it is the one kept. */
	clear(view: EditorView): void {
		if (current?.view === view) current = null;
	},
	/** The active editor, while it is on the page. */
	get(): ActiveEditor | null {
		return current?.view.dom.isConnected ? current : null;
	},
};
