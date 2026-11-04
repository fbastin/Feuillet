// src/utils/dropReference.ts
// What a file of the project, dragged from the file tree onto the editor,
// puts there: a figure for an image, \input for a LaTeX part, the
// bibliography for a .bib, #include in Typst..., else its path.
import { isFigureImage } from './latexFigureUtils';

export type DropReference = { kind: 'figure' } | { kind: 'text'; text: string };

/** What the file tree puts in a drag: the node it carries. */
export interface TreeDrag {
	nodeId: string;
	nodePath: string;
	nodeType: 'file' | 'directory';
}

export const treeDragOf = (data: string): TreeDrag | null => {
	if (!data.startsWith('{')) return null;
	try {
		const parsed = JSON.parse(data);
		return typeof parsed?.nodeId === 'string' &&
			typeof parsed.nodePath === 'string' &&
			(parsed.nodeType === 'file' || parsed.nodeType === 'directory')
			? {
					nodeId: parsed.nodeId,
					nodePath: parsed.nodePath,
					nodeType: parsed.nodeType,
				}
			: null;
	} catch {
		return null;
	}
};

const extensionOf = (path: string) =>
	/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
const withoutExtension = (path: string) => path.replace(/\.[^./]+$/, '');

// What Typst's image() and Markdown's images show.
const TYPST_IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
const MARKDOWN_IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];

/**
 * `path` is the file's path as the document names it (relative to the main
 * file for LaTeX); `documentText` tells biblatex from BibTeX.
 */
export const dropReference = (
	fileType: string,
	path: string,
	documentText: string,
	nodeType: 'file' | 'directory' = 'file',
): DropReference => {
	if (nodeType === 'directory') return { kind: 'text', text: path };
	const extension = extensionOf(path);
	if (fileType === 'latex') {
		if (isFigureImage(path)) return { kind: 'figure' };
		if (extension === 'tex') {
			return { kind: 'text', text: `\\input{${withoutExtension(path)}}` };
		}
		if (extension === 'bib') {
			const biblatex =
				/\\usepackage(\[[^\]]*\])?\{biblatex\}|\\addbibresource/.test(
					documentText,
				);
			return {
				kind: 'text',
				text: biblatex
					? `\\addbibresource{${path}}`
					: `\\bibliography{${withoutExtension(path)}}`,
			};
		}
	} else if (fileType === 'typst') {
		if (TYPST_IMAGES.includes(extension)) return { kind: 'figure' };
		if (extension === 'typ')
			return { kind: 'text', text: `#include "${path}"` };
		if (extension === 'bib' || extension === 'yml' || extension === 'yaml') {
			return { kind: 'text', text: `#bibliography("${path}")` };
		}
	} else if (fileType === 'markdown') {
		if (MARKDOWN_IMAGES.includes(extension)) return { kind: 'figure' };
	}
	return { kind: 'text', text: path };
};
