// src/utils/projectStarterUtils.ts
import type { FileNode } from '../types/files';
import type { ProjectType } from '../types/projects';
import { getMimeType } from './fileUtils';

const LATEX_REPLACEMENTS: Record<string, string> = {
	'\\': '\\textbackslash{}',
	'~': '\\textasciitilde{}',
	'^': '\\textasciicircum{}',
};

const escapeLatex = (text: string): string =>
	text.replace(
		/[\\{}$&#%_~^]/g,
		(char) => LATEX_REPLACEMENTS[char] ?? `\\${char}`,
	);

const typstString = (text: string): string =>
	`"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const latexStarter = (title: string, author: string): string =>
	[
		'\\documentclass{article}',
		'\\usepackage{graphicx} % Required for inserting images',
		'',
		`\\title{${escapeLatex(title)}}`,
		`\\author{${escapeLatex(author)}}`,
		'\\date{\\today}',
		'',
		'\\begin{document}',
		'',
		'\\maketitle',
		'',
		'\\section{Introduction}',
		'',
		'\\end{document}',
		'',
	].join('\n');

const typstStarter = (title: string, author: string): string =>
	[
		`#set document(title: ${typstString(title)}, author: ${typstString(author)})`,
		'#set page(numbering: "1")',
		'#set heading(numbering: "1.")',
		'',
		`#align(center, text(17pt, weight: "bold", ${typstString(title)}))`,
		`#align(center, ${typstString(author)})`,
		'',
		'= Introduction',
		'',
	].join('\n');

/**
 * Overleaf-style starter document for a new blank project, or null for
 * project types without a built-in starter.
 */
export function createStarterFile(
	type: ProjectType,
	title: string,
	author: string,
): FileNode | null {
	const starter =
		type === 'latex'
			? { name: 'main.tex', content: latexStarter(title, author) }
			: type === 'typst'
				? { name: 'main.typ', content: typstStarter(title, author) }
				: null;
	if (!starter) return null;

	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name: starter.name,
		path: `/${starter.name}`,
		type: 'file',
		content: starter.content,
		createdAt: now,
		lastModified: now,
		size: new TextEncoder().encode(starter.content).byteLength,
		mimeType: getMimeType(starter.name),
		isBinary: false,
		isDeleted: false,
	};
}
