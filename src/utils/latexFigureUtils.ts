// src/utils/latexFigureUtils.ts
// Figures as Overleaf's "Insert figure" writes them: the image centred, as
// wide as a part of the line, with a caption and a label to refer to it.
import type { EditorView } from '@codemirror/view';
import { nanoid } from 'nanoid';

import { fileStoreService } from '../services/FileStoreService';
import type { FileNode } from '../types/files';

export const INSERT_FIGURE_EVENT = 'feuillet-insert-figure';

/** Inserting a figure, or editing or replacing the image of the selected one. */
export type FigureDialogMode = 'insert' | 'edit' | 'replace';

/** Asks the editor holding `view` to open its figure dialog. */
export const requestFigureDialog = (
	view: EditorView,
	mode: FigureDialogMode,
): void => {
	document.dispatchEvent(
		new CustomEvent(INSERT_FIGURE_EVENT, { detail: { view, mode } }),
	);
};

/** Asks the editor holding `view` to open its "Insert figure" dialog. */
export const requestInsertFigure = (view: EditorView): void =>
	requestFigureDialog(view, 'insert');

// What \includegraphics reads with pdfLaTeX, LuaLaTeX and XeLaTeX.
const FIGURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'pdf', 'eps'];
// What a browser can show as a preview.
const PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg'];

const extensionOf = (path: string) =>
	/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';

export const isFigureImage = (path: string): boolean =>
	FIGURE_EXTENSIONS.includes(extensionOf(path));

export const canPreviewImage = (path: string): boolean =>
	PREVIEW_EXTENSIONS.includes(extensionOf(path));

/** A label for the figure of an image, e.g. fig:plan-du-site. */
export const figureLabel = (path: string): string => {
	const name = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
	const slug = name
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `fig:${slug || 'figure'}`;
};

export interface FigureOptions {
	path: string;
	/** The part of the line width, from 0 to 1. */
	width: number;
	caption: string | null;
	label: string | null;
}

/** The LaTeX of a figure, and where its caption is in it. */
export const figureLatex = (
	{ path, width, caption, label }: FigureOptions,
	indent = '\t',
): { text: string; caption?: { from: number; to: number } } => {
	const size = width >= 1 ? '' : String(Number(width.toFixed(2)));
	const lines = [
		'\\begin{figure}',
		`${indent}\\centering`,
		`${indent}\\includegraphics[width=${size}\\linewidth]{${path}}`,
	];
	let captionRange: { from: number; to: number } | undefined;
	if (caption !== null) {
		const prefix = `${indent}\\caption{`;
		const from = lines.join('\n').length + 1 + prefix.length;
		captionRange = { from, to: from + caption.length };
		lines.push(`${prefix}${caption}}`);
	}
	if (label) lines.push(`${indent}\\label{${label}}`);
	lines.push('\\end{figure}');
	return { text: lines.join('\n'), caption: captionRange };
};

/**
 * Puts a figure on its own lines at the cursor, and selects its caption so
 * that typing replaces it.
 */
export const insertFigure = (
	view: EditorView,
	text: string,
	caption?: { from: number; to: number },
): void => {
	const { state } = view;
	const line = state.doc.lineAt(state.selection.main.head);
	const blank = line.text.trim() === '';
	const from = blank ? line.from : line.to;
	const offset = from + (blank ? 0 : 1);
	view.dispatch({
		changes: { from, to: line.to, insert: blank ? text : `\n${text}` },
		selection: caption
			? { anchor: offset + caption.from, head: offset + caption.to }
			: { anchor: offset + text.length },
		scrollIntoView: true,
		userEvent: 'input',
	});
	view.focus();
};

/**
 * Adds an image to the project's images folder, under a name of its own,
 * and gives its path in the project.
 */
export const addFigureImage = async (file: File): Promise<string> => {
	const dot = file.name.lastIndexOf('.');
	const stem = (dot > 0 ? file.name.slice(0, dot) : file.name)
		.trim()
		.replace(/\s+/g, '-');
	const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
	let path = `/images/${stem}${extension}`;
	for (let copy = 1; await fileStoreService.getFileByPath(path); copy++) {
		path = `/images/${stem}-${copy}${extension}`;
	}
	await fileStoreService.createDirectoryPath(path);
	const node: FileNode = {
		id: nanoid(),
		name: path.split('/').pop() ?? file.name,
		path,
		type: 'file',
		content: await file.arrayBuffer(),
		lastModified: Date.now(),
		size: file.size,
		mimeType: file.type || undefined,
		isBinary: true,
	};
	await fileStoreService.storeFile(node, { showConflictDialog: false });
	document.dispatchEvent(new CustomEvent('refresh-file-tree'));
	return path;
};
