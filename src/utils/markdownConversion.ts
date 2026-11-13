// src/utils/markdownConversion.ts
// Markdown with Pandoc, as Overleaf's export and import (the conversion runs
// on the TeX Live server, server/texlive/server.js): what goes with the
// Markdown a project becomes, and what a Markdown file to import says of
// itself.

const stripSlash = (path: string): string => path.replace(/^\/+/, '');

const directoryOf = (path: string): string => {
	const at = stripSlash(path).lastIndexOf('/');
	return at < 0 ? '' : stripSlash(path).slice(0, at);
};

const normalize = (path: string): string | null => {
	const parts: string[] = [];
	for (const part of path.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (parts.length === 0) return null;
			parts.pop();
		} else parts.push(part);
	}
	return parts.join('/');
};

// What LaTeX tries after a figure named without its extension.
const IMAGE_EXTENSIONS = [
	'.pdf',
	'.png',
	'.jpg',
	'.jpeg',
	'.svg',
	'.gif',
	'.eps',
	'.webp',
];

const isLocal = (target: string): boolean =>
	!!target && !target.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(target);

/**
 * The project's images a Markdown made from `mainFile` shows: its links
 * rewritten to the files found (an extension LaTeX left out added), and
 * those files' paths in the project.
 */
export function collectMarkdownMedia(
	markdown: string,
	mainFile: string,
	projectPaths: readonly string[],
): { markdown: string; media: string[] } {
	const paths = new Set(projectPaths.map(stripSlash));
	const base = directoryOf(mainFile);
	const media = new Set<string>();

	const find = (target: string): string | null => {
		const decoded = (() => {
			try {
				return decodeURI(target);
			} catch {
				return target;
			}
		})();
		const resolved = normalize(base ? `${base}/${decoded}` : decoded);
		if (!resolved) return null;
		if (paths.has(resolved)) return resolved;
		for (const extension of IMAGE_EXTENSIONS) {
			if (paths.has(resolved + extension)) return resolved + extension;
		}
		// Found by \graphicspath: the one file of that name.
		const name = resolved.split('/').pop() ?? resolved;
		const found = [...paths].filter((path) => {
			const file = path.split('/').pop() ?? path;
			return (
				file === name ||
				IMAGE_EXTENSIONS.some((extension) => file === name + extension)
			);
		});
		return found.length === 1 ? found[0] : null;
	};

	const relativeTo = (path: string): string => {
		if (!base) return path;
		const from = base.split('/');
		const to = path.split('/');
		let common = 0;
		while (
			common < from.length &&
			common < to.length - 1 &&
			from[common] === to[common]
		) {
			common++;
		}
		return [...from.slice(common).map(() => '..'), ...to.slice(common)].join(
			'/',
		);
	};

	const rewritten = markdown.replace(
		/(!\[[^\]]*\]\()(<[^>\n]*>|[^\s)]+)((?:\s+"[^"]*")?\))/g,
		(whole, start: string, rawTarget: string, end: string) => {
			const bracketed = rawTarget.startsWith('<');
			const target = bracketed ? rawTarget.slice(1, -1) : rawTarget;
			if (!isLocal(target)) return whole;
			const found = find(target);
			if (!found) return whole;
			media.add(found);
			const link = relativeTo(found);
			const written = /[\s()<>]/.test(link) ? `<${link}>` : encodeURI(link);
			return `${start}${written}${end}`;
		},
	);
	return { markdown: rewritten, media: [...media].sort() };
}

const FRONT_MATTER =
	/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

const frontMatterField = (markdown: string, field: string): string | null => {
	const block = FRONT_MATTER.exec(markdown.replace(/^﻿/, ''))?.[1];
	if (!block) return null;
	const line = new RegExp(`^${field}\\s*:\\s*(.+?)\\s*$`, 'm').exec(block)?.[1];
	if (!line) return null;
	return line.replace(/^(['"])(.*)\1$/, '$2').trim() || null;
};

/** The title a Markdown file gives itself in its YAML block, if any. */
export const markdownTitle = (markdown: string): string | null =>
	frontMatterField(markdown, 'title');

/** Whether a Markdown file names its language in its YAML block. */
export const markdownDeclaresLanguage = (markdown: string): boolean =>
	frontMatterField(markdown, 'lang') !== null;

/** The text of a Markdown file without its YAML block, to guess its language. */
export const markdownBody = (markdown: string): string =>
	markdown.replace(/^﻿/, '').replace(FRONT_MATTER, '');

const MARKDOWN_FILE = /\.(md|markdown)$/i;

export const isMarkdownFile = (path: string): boolean =>
	MARKDOWN_FILE.test(path);

/**
 * The Markdown file an archive is about: main.md, index.md or README.md,
 * else the first, the nearest the root first.
 */
export function chooseMainMarkdown(paths: readonly string[]): string | null {
	const candidates = paths
		.filter(isMarkdownFile)
		.sort(
			(a, b) =>
				stripSlash(a).split('/').length - stripSlash(b).split('/').length ||
				a.localeCompare(b),
		);
	for (const name of ['main', 'index', 'readme']) {
		const found = candidates.find(
			(path) =>
				(path.split('/').pop() ?? '')
					.replace(MARKDOWN_FILE, '')
					.toLowerCase() === name,
		);
		if (found) return found;
	}
	return candidates[0] ?? null;
}

/**
 * Where the LaTeX made from `markdownPath` goes: main.tex beside it, else a
 * name of its own, without replacing a file.
 */
export function latexPathFor(
	markdownPath: string,
	existing: readonly string[],
): string {
	const taken = new Set(existing.map((path) => stripSlash(path).toLowerCase()));
	const directory = directoryOf(markdownPath);
	const at = (name: string) => (directory ? `${directory}/${name}` : name);
	const stem =
		(markdownPath.split('/').pop() ?? 'document').replace(MARKDOWN_FILE, '') ||
		'document';
	for (const name of ['main.tex', `${stem}.tex`]) {
		if (!taken.has(at(name).toLowerCase())) return `/${at(name)}`;
	}
	let index = 2;
	while (taken.has(at(`${stem}-${index}.tex`).toLowerCase())) index++;
	return `/${at(`${stem}-${index}.tex`)}`;
}
