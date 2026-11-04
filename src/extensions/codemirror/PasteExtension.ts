// src/extensions/codemirror/PasteExtension.ts
import { EditorView } from '@codemirror/view';

import { createNamedLogger } from '@/logging';
import { detectFileType } from '../../utils/fileUtils';
import {
	extractUploadableBlob,
	pathFromCurrentFile,
	readClipboardBlob,
	uploadPastedFile,
} from '../../utils/clipboardUtils';
import { dropReference, treeDragOf } from '../../utils/dropReference';
import { runToolbarCommand } from './ToolbarExtension';

const moduleLog = createNamedLogger('PasteExtension');

let pendingImagePath: string | null = null;

export function getPendingImagePath(): string | null {
	const path = pendingImagePath;
	pendingImagePath = null;
	return path;
}

export const createPasteExtension = (
	currentFileId?: string,
	fileName?: string,
) => {
	const insertFigure = (view: EditorView, path: string): boolean => {
		pendingImagePath = path;
		const fileType = detectFileType(fileName, view.state.doc.toString());
		const didRun =
			runToolbarCommand(view, `${fileType}-figure`) ||
			runToolbarCommand(view, `${fileType}-image`);
		if (!didRun) {
			moduleLog.warn('Figure command not found in toolbar');
			pendingImagePath = null;
		}
		return didRun;
	};

	const insert = (view: EditorView, blob: Blob, name?: string) => {
		uploadPastedFile(blob, currentFileId, name)
			.then((uploadedPath) => insertFigure(view, uploadedPath))
			.catch((error) => {
				moduleLog.error('Error handling pasted file:', error);
			});
	};

	// Where the pointer let go, for what goes in there.
	const placeAtDrop = (view: EditorView, event: DragEvent) => {
		const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
		if (at !== null) view.dispatch({ selection: { anchor: at } });
		view.focus();
	};

	// A file of the project, from the file tree: what refers to it.
	const insertReference = async (
		view: EditorView,
		nodePath: string,
		nodeType: 'file' | 'directory',
	) => {
		const path = await pathFromCurrentFile(nodePath, currentFileId);
		const text = view.state.doc.toString();
		const reference = dropReference(
			detectFileType(fileName, text),
			path,
			text,
			nodeType,
		);
		if (reference.kind === 'figure' && insertFigure(view, path)) return;
		const insertText = reference.kind === 'text' ? reference.text : path;
		const { from, to } = view.state.selection.main;
		view.dispatch({
			changes: { from, to, insert: insertText },
			selection: { anchor: from + insertText.length },
			userEvent: 'input.drop',
		});
	};

	return EditorView.domEventHandlers({
		// A file of the tree or of the computer goes in as a copy.
		dragover: (event, view) => {
			const types = Array.from(event.dataTransfer?.types ?? []);
			if (view.state.readOnly || !types.includes('Files')) return false;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
			return false;
		},
		drop: (event, view) => {
			if (view.state.readOnly || !event.dataTransfer) return false;
			// A file dragged from the file tree, which carries its node.
			const node = treeDragOf(event.dataTransfer.getData('text/plain'));
			if (node) {
				event.preventDefault();
				placeAtDrop(view, event);
				void insertReference(view, node.nodePath, node.nodeType);
				return true;
			}
			// An image or a PDF from the computer joins the project, as a
			// pasted one.
			const file = Array.from(event.dataTransfer.files).find(
				(candidate) =>
					candidate.type.startsWith('image/') ||
					candidate.type === 'application/pdf',
			);
			if (!file) return false;
			event.preventDefault();
			placeAtDrop(view, event);
			insert(view, file, file.name);
			return true;
		},
		paste: (event, view) => {
			// Pasting an image adds a file to the project.
			if (view.state.readOnly) return false;
			const syncBlob = extractUploadableBlob(event);
			if (syncBlob) {
				event.preventDefault();
				insert(view, syncBlob);
				return true;
			}

			const types = Array.from(event.clipboardData?.types ?? []);
			const hasImageHint = types.some(
				(type) => type.startsWith('image/') || type === 'text/uri-list',
			);
			if (!hasImageHint) return false;

			event.preventDefault();
			readClipboardBlob().then((blob) => {
				if (blob) insert(view, blob);
			});

			return true;
		},
	});
};
