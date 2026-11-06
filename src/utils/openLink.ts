// src/utils/openLink.ts
// « Ouvrir dans Feuillet », as Overleaf's "Open in Overleaf": what a link or
// a form to /docs asks for (server/collab/docs.js keeps it for the page),
// and the project's files made of it.
import { isRootLatexDocument } from './compilerUtils';

export interface OpenLinkSource {
	/** LaTeX code given in the link. */
	text?: string;
	/** A file's address: http, https or data:. */
	uri?: string;
}

/** Overleaf's names of its compilers. */
export type OverleafEngine =
	| 'latex_dvipdf'
	| 'pdflatex'
	| 'xelatex'
	| 'lualatex';

export interface OpenLinkRequest {
	sources: OpenLinkSource[];
	/** The files' names, in the order of the sources, as many as given. */
	names: string[];
	engine?: OverleafEngine;
	mainDocument?: string;
	visualEditor?: boolean;
}

/** The engines of Feuillet's TeX Live for Overleaf's. */
export const ENGINE_OF: Record<OverleafEngine, string> = {
	pdflatex: 'pdflatex',
	latex_dvipdf: 'latex',
	xelatex: 'xelatex',
	lualatex: 'lualatex',
};

const ID = /^[A-Za-z0-9_-]{32}$/;

/** The kept request a page address points to (#open:<id>). */
export const openLinkIdOf = (hash: string): string | null => {
	const match = /^#?open:(.*)$/.exec(hash);
	return match && ID.test(match[1]) ? match[1] : null;
};

/** The request as the server keeps it, checked, or null. */
export const parseOpenLinkRequest = (
	value: unknown,
): OpenLinkRequest | null => {
	if (!value || typeof value !== 'object') return null;
	const input = value as Record<string, unknown>;
	if (!Array.isArray(input.sources) || input.sources.length === 0) return null;
	const sources: OpenLinkSource[] = [];
	for (const source of input.sources) {
		if (source && typeof source.text === 'string') {
			sources.push({ text: source.text });
		} else if (
			source &&
			typeof source.uri === 'string' &&
			/^(?:https?|data):/i.test(source.uri)
		) {
			sources.push({ uri: source.uri });
		} else {
			return null;
		}
	}
	const names = Array.isArray(input.names)
		? input.names.filter((name): name is string => typeof name === 'string')
		: [];
	const engine =
		typeof input.engine === 'string' && input.engine in ENGINE_OF
			? (input.engine as OverleafEngine)
			: undefined;
	return {
		sources,
		names,
		...(engine ? { engine } : {}),
		...(typeof input.mainDocument === 'string' && input.mainDocument
			? { mainDocument: input.mainDocument }
			: {}),
		...(input.visualEditor === true ? { visualEditor: true } : {}),
	};
};

/** A name usable as a file's, without folders or odd characters. */
export const safeFileName = (name: string): string =>
	(name.split(/[\\/]/).pop() ?? '')
		// biome-ignore lint/suspicious/noControlCharactersInRegex: removed on purpose
		.replace(/[\u0000-\u001f<>:"|?*]/g, '')
		.trim()
		.replace(/^\.+/, '')
		.slice(0, 120);

const MIME_EXTENSIONS: Record<string, string> = {
	'application/zip': 'zip',
	'application/x-zip-compressed': 'zip',
	'application/x-tex': 'tex',
	'application/x-latex': 'tex',
	'text/x-tex': 'tex',
	'text/plain': 'tex',
	'application/x-bibtex': 'bib',
	'text/x-bibtex': 'bib',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'application/pdf': 'pdf',
};

/** The media type of a data: URL. */
export const dataUrlType = (uri: string): string =>
	/^data:([^;,]*)/i.exec(uri)?.[1]?.toLowerCase() || 'text/plain';

/** The bytes of a data: URL, base64 or not. */
export const dataUrlBytes = (uri: string): Uint8Array => {
	const comma = uri.indexOf(',');
	if (comma < 0) throw new Error('Not a data: URL');
	const header = uri.slice(5, comma);
	const body = uri.slice(comma + 1);
	if (/;base64$/i.test(header)) {
		const binary = atob(decodeURIComponent(body).replace(/\s+/g, ''));
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	}
	return new TextEncoder().encode(decodeURIComponent(body));
};

/**
 * A source's file name: the one the link gives, else the address's last
 * part, else `main.tex` for the first LaTeX code and fileN for the others.
 */
export const sourceFileName = (
	source: OpenLinkSource,
	index: number,
	given: string | undefined,
): string => {
	const own = given ? safeFileName(given) : '';
	if (own) return own;
	if (source.uri && !/^data:/i.test(source.uri)) {
		try {
			const last = new URL(source.uri).pathname.split('/').pop() ?? '';
			const name = safeFileName(decodeURIComponent(last));
			if (name) return name;
		} catch {}
	}
	const extension = source.uri
		? (MIME_EXTENSIONS[dataUrlType(source.uri)] ?? 'tex')
		: 'tex';
	return index === 0 && extension === 'tex'
		? 'main.tex'
		: `file${index + 1}.${extension}`;
};

/** Whether bytes are a zip archive, whatever its name. */
export const isZip = (bytes: Uint8Array, name: string): boolean =>
	/\.zip$/i.test(name) ||
	(bytes.length > 3 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04);

/**
 * Overleaf's preamble for code without \documentclass, so that a formula or
 * a TikZ picture given alone compiles.
 */
export const wrapSnippet = (text: string): string =>
	[
		'\\documentclass[12pt]{article}',
		'\\usepackage[english]{babel}',
		'\\usepackage{amsmath}',
		'\\usepackage{tikz}',
		'\\begin{document}',
		text.replace(/\n+$/, ''),
		'\\end{document}',
		'',
	].join('\n');

/** The GitHub repository a GitHub archive's address is of. */
export const githubRepositoryOf = (uri: string): string | null => {
	try {
		const url = new URL(uri);
		const parts = url.pathname.split('/').filter(Boolean);
		if (url.hostname === 'github.com' && parts[2] === 'archive') {
			return parts[1] ?? null;
		}
		if (url.hostname === 'codeload.github.com' && parts[2] === 'zip') {
			return parts[1] ?? null;
		}
	} catch {}
	return null;
};

/** What to call the project: the repository, else the first file. */
export const projectNameOf = (
	request: OpenLinkRequest,
	fallback: string,
): string => {
	const main = request.mainDocument ? safeFileName(request.mainDocument) : '';
	if (main) return main.replace(/\.[^.]+$/, '');
	const first = request.sources[0];
	if (first?.uri) {
		const repository = githubRepositoryOf(first.uri);
		if (repository) return repository;
	}
	const name = first ? sourceFileName(first, 0, request.names[0]) : '';
	if (first?.text !== undefined && !request.names[0]) {
		const title = /\\title\s*\{([^{}\n]{1,120})\}/.exec(first.text)?.[1];
		if (title?.trim()) return title.trim();
		return fallback;
	}
	return name.replace(/\.[^.]+$/, '') || fallback;
};

/** The file to compile: the one asked for, else the one that is a document. */
export const mainDocumentOf = (
	files: { path: string; text?: string }[],
	requested: string | undefined,
): string | undefined => {
	const latex = files.filter((file) => /\.tex$/i.test(file.path));
	if (requested) {
		const wanted = requested.replace(/^\/+/, '');
		const found =
			latex.find((file) => file.path === `/${wanted}`) ??
			latex.find((file) => file.path.split('/').pop() === safeFileName(wanted));
		if (found) return found.path;
	}
	const roots = latex.filter(
		(file) => file.text !== undefined && isRootLatexDocument(file.text),
	);
	return (
		roots.find((file) => file.path === '/main.tex')?.path ??
		roots.sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0]
			?.path
	);
};

/** How a source reads in the dialog: a site and a name, or LaTeX code. */
export const describeSource = (
	source: OpenLinkSource,
): { kind: 'text'; lines: number } | { kind: 'uri'; host: string } => {
	if (source.text !== undefined) {
		return { kind: 'text', lines: source.text.split('\n').length };
	}
	if (source.uri && /^data:/i.test(source.uri)) {
		return { kind: 'uri', host: '' };
	}
	try {
		return { kind: 'uri', host: new URL(source.uri ?? '').hostname };
	} catch {
		return { kind: 'uri', host: '' };
	}
};
