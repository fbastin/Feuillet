// src/utils/projectStarterUtils.ts
import type { FileNode } from '../types/files';
import type { ProjectType } from '../types/projects';
import { getMimeType, isBinaryFile } from './fileUtils';

/** The languages the starter documents and templates are written in. */
export type TemplateLanguage = 'fr' | 'en';

/** Overleaf's new-project templates, with Overleaf's blank and example projects. */
export const PROJECT_TEMPLATE_IDS = [
	'blank',
	'example',
	'article',
	'book',
	'letter',
	'homework',
	'poster',
	'presentation',
	'report',
	'cv',
	'thesis',
] as const;

export type ProjectTemplateId = (typeof PROJECT_TEMPLATE_IDS)[number];

export interface ProjectTemplateChoice {
	id: ProjectTemplateId;
	language: TemplateLanguage;
}

/** What a template fills in: the project's name and the user's name. */
export interface TemplateValues {
	title: string;
	author: string;
}

/** A file of a template, as written in src/assets/templates/<id>/<language>. */
export interface TemplateEntry {
	path: string;
	content: string | ArrayBuffer;
}

export const templateLanguageFor = (language: string): TemplateLanguage =>
	language.toLowerCase().startsWith('fr') ? 'fr' : 'en';

const LATEX_REPLACEMENTS: Record<string, string> = {
	'\\': '\\textbackslash{}',
	'~': '\\textasciitilde{}',
	'^': '\\textasciicircum{}',
};

export const escapeLatex = (text: string): string =>
	text.replace(
		/[\\{}$&#%_~^]/g,
		(char) => LATEX_REPLACEMENTS[char] ?? `\\${char}`,
	);

const typstString = (text: string): string =>
	`"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const latexStarter = (
	title: string,
	author: string,
	language: TemplateLanguage,
): string =>
	[
		'\\documentclass{article}',
		...(language === 'fr'
			? [
					'\\usepackage[T1]{fontenc}',
					'\\usepackage[french]{babel}',
					'\\usepackage{graphicx} % Pour insérer des images',
				]
			: ['\\usepackage{graphicx} % Required for inserting images']),
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

const typstStarter = (
	title: string,
	author: string,
	language: TemplateLanguage,
): string =>
	[
		`#set document(title: ${typstString(title)}, author: ${typstString(author)})`,
		...(language === 'fr' ? ['#set text(lang: "fr")'] : []),
		'#set page(numbering: "1")',
		'#set heading(numbering: "1.")',
		'',
		`#align(center, text(17pt, weight: "bold", ${typstString(title)}))`,
		`#align(center, ${typstString(author)})`,
		'',
		'= Introduction',
		'',
	].join('\n');

const fileNode = (path: string, content: string | ArrayBuffer): FileNode => {
	const name = path.split('/').pop() ?? path;
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		path,
		type: 'file',
		content,
		createdAt: now,
		lastModified: now,
		size:
			typeof content === 'string'
				? new TextEncoder().encode(content).byteLength
				: content.byteLength,
		mimeType: getMimeType(name),
		isBinary: typeof content !== 'string' && isBinaryFile(name),
		isDeleted: false,
	};
};

/**
 * Overleaf-style starter document for a new blank project, or null for
 * project types without a built-in starter.
 */
export function createStarterFile(
	type: ProjectType,
	title: string,
	author: string,
	language: TemplateLanguage = 'en',
): FileNode | null {
	const starter =
		type === 'latex'
			? { name: 'main.tex', content: latexStarter(title, author, language) }
			: type === 'typst'
				? { name: 'main.typ', content: typstStarter(title, author, language) }
				: null;
	if (!starter) return null;
	return fileNode(`/${starter.name}`, starter.content);
}

// "Ada Lovelace" -> ["Ada", "Lovelace"]; the last word is the family name.
const splitName = (author: string): [string, string] => {
	const words = author.trim().split(/\s+/).filter(Boolean);
	if (words.length < 2) return [words[0] ?? '', ''];
	return [words.slice(0, -1).join(' '), words[words.length - 1]];
};

/** Puts the project's title and the author's name in a template's LaTeX. */
export function fillTemplate(text: string, values: TemplateValues): string {
	const [firstName, lastName] = splitName(values.author);
	const fields: Record<string, string> = {
		TITLE: values.title,
		AUTHOR: values.author.trim(),
		FIRST_NAME: firstName,
		LAST_NAME: lastName,
	};
	return text.replace(
		/\{\{(TITLE|AUTHOR|FIRST_NAME|LAST_NAME)\}\}/g,
		(_, field: string) => escapeLatex(fields[field]),
	);
}

/** The files and folders of a new project made from a template. */
export function createTemplateFiles(
	entries: TemplateEntry[],
	values: TemplateValues,
): FileNode[] {
	const now = Date.now();
	const folders = new Set<string>();
	for (const { path } of entries) {
		const parts = path.split('/').filter(Boolean);
		for (let index = 1; index < parts.length; index++) {
			folders.add(`/${parts.slice(0, index).join('/')}`);
		}
	}
	const directories: FileNode[] = [...folders].sort().map((path) => ({
		id: crypto.randomUUID(),
		name: path.split('/').pop() ?? path,
		path,
		type: 'directory',
		createdAt: now,
		lastModified: now,
		isDeleted: false,
	}));
	const files = [...entries]
		.sort((a, b) => a.path.localeCompare(b.path))
		.map(({ path, content }) =>
			fileNode(
				path,
				typeof content === 'string' && path.endsWith('.tex')
					? fillTemplate(content, values)
					: content,
			),
		);
	return [...directories, ...files];
}
