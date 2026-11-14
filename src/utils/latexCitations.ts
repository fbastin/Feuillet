// src/utils/latexCitations.ts
// The citations of a LaTeX text: each key of \cite, \citep, \parencite,
// \textcite, \nocite and the other commands of natbib, biblatex or apacite,
// with where it is written, to tell which entries of a .bib are cited and to
// rename a key where it is cited. What a comment holds is told apart (renamed
// with the rest, not counted as cited); verbatim text and the review's
// annotation tags hold no citation.
import { type BibChange, parseBibDocument } from './bibDocument';

export interface Citation {
	key: string;
	/** Where the key is written, inside the braces. */
	from: number;
	to: number;
	/** In a % comment. */
	commented: boolean;
}

export interface CitationScan {
	citations: Citation[];
	/** \nocite{*}: every entry is in the bibliography. */
	everything: boolean;
	/** Keys the text gives an entry: \bibitem, or a .bib in filecontents. */
	defined: string[];
}

// Commands with « cite » in their name that take no key.
const NOT_CITATIONS = new Set([
	'citestyle',
	'citetext',
	'citesetup',
	'citereset',
	'citeindextype',
	'mancite',
	'nocitecategory',
]);

/** \cite, \citep, \Textcite, \footfullcite, \defcitealias, \bibentry… */
export function isCitationCommand(name: string): boolean {
	if (name === 'bibentry') return true;
	const lower = name.toLowerCase();
	if (!lower.includes('cite') || NOT_CITATIONS.has(lower)) return false;
	// Definitions and settings: \DeclareCiteCommand, \setcitestyle,
	// \citeindextrue, \bibpunct-like \citepunct…
	if (/^(new|renew|provide|declare|set|if|let|undef)/.test(lower)) return false;
	if (lower.startsWith('def') && lower !== 'defcitealias') return false;
	return !/(true|false|style|punct|delim|setup|reset)$/.test(lower);
}

// Environments whose text is not LaTeX.
const VERBATIM = new Set([
	'verbatim',
	'verbatim*',
	'Verbatim',
	'Verbatim*',
	'BVerbatim',
	'LVerbatim',
	'lstlisting',
	'minted',
	'comment',
	'filecontents',
	'filecontents*',
]);

const ANNOTATION_TAG =
	/`?<###(?:\s|%)*(?:comment|review)(?:\s|%)*id:[\s\S]*?###>`?|`?<\/###(?:\s|%)*(?:comment|review)(?:\s|%)*id:(?:\s|%)*[\w-]+(?:\s|%)*###>`?/g;

/** The review's tags as spaces: the text keeps its length, its lines. */
function withoutAnnotations(text: string): string {
	if (!text.includes('###')) return text;
	return text.replace(ANNOTATION_TAG, (tag) => tag.replace(/[^\n]/g, ' '));
}

// A key: no space, brace, comma, backslash, # or %.
const KEY = /^[^\s{}\\#%,]+$/;

export function scanCitations(source: string): CitationScan {
	const text = withoutAnnotations(source);
	const length = text.length;
	const citations: Citation[] = [];
	const defined: string[] = [];
	let everything = false;
	// The end of the comment the scan is in, or -1.
	let commentEnd = -1;

	const lineEnd = (at: number) => {
		const end = text.indexOf('\n', at);
		return end < 0 ? length : end;
	};
	const isLetter = (char: string | undefined) =>
		char !== undefined && /[a-zA-Z@]/.test(char);

	/** Spaces and one line break: a blank line ends the arguments. */
	const skipSpace = (at: number, limit: number) => {
		let position = at;
		let breaks = 0;
		while (position < limit) {
			const char = text[position];
			if (char === '\n') {
				if (++breaks > 1) break;
			} else if (char !== ' ' && char !== '\t' && char !== '\r') break;
			position++;
		}
		return position;
	};

	/** The end (after the closing character) of a group opening at `at`. */
	const groupEnd = (at: number, limit: number): number => {
		const open = text[at];
		const close = open === '{' ? '}' : open === '[' ? ']' : ')';
		let depth = 0;
		for (let position = at + 1; position < limit; position++) {
			const char = text[position];
			if (char === '\\') position++;
			else if (char === '%' && open === '{') {
				// A comment inside the braces: the group goes on the next line.
				position = lineEnd(position);
			} else if (char === '{') depth++;
			else if (char === '}') {
				if (depth === 0) return open === '{' ? position + 1 : -1;
				depth--;
			} else if (char === close && depth === 0) return position + 1;
		}
		return -1;
	};

	/** The keys between the braces of a group, at `from`…`to`. */
	const readKeys = (from: number, to: number, commented: boolean) => {
		let depth = 0;
		let start = from + 1;
		const pieces: Array<[number, number]> = [];
		for (let position = from + 1; position < to - 1; position++) {
			const char = text[position];
			if (char === '{') depth++;
			else if (char === '}') depth--;
			else if (char === ',' && depth === 0) {
				pieces.push([start, position]);
				start = position + 1;
			}
		}
		pieces.push([start, to - 1]);
		for (const [pieceFrom, pieceTo] of pieces) {
			const piece = text.slice(pieceFrom, pieceTo);
			const key = piece.trim();
			if (key === '*') {
				if (!commented) everything = true;
				continue;
			}
			if (!KEY.test(key)) continue;
			const keyFrom = pieceFrom + piece.indexOf(key);
			citations.push({
				key,
				from: keyFrom,
				to: keyFrom + key.length,
				commented,
			});
		}
	};

	/** Optional arguments, up to `count` of them, from `at`. */
	const skipOptions = (
		at: number,
		limit: number,
		open: '[' | '(',
		count: number,
	) => {
		let position = at;
		for (let i = 0; i < count; i++) {
			const next = skipSpace(position, limit);
			if (text[next] !== open) break;
			const end = groupEnd(next, limit);
			if (end < 0) break;
			position = end;
		}
		return position;
	};

	/**
	 * A citation's arguments from `at`, after its name: its keys, and where
	 * it ends, or -1 when it has no braces where the keys go.
	 * \cites[pre][post]{a}[pre][post]{b} gives several; \volcite gives the
	 * volume before the key.
	 */
	const readCitation = (
		name: string,
		at: number,
		limit: number,
		commented: boolean,
	): number => {
		const lower = name.toLowerCase();
		const multiple = lower.endsWith('cites');
		const volume = lower.includes('volcite');
		let position = at;
		if (text[position] === '*') position++;
		if (multiple) position = skipOptions(position, limit, '(', 2);
		let found = false;
		for (;;) {
			position = skipOptions(position, limit, '[', 2);
			let open = skipSpace(position, limit);
			if (volume) {
				if (text[open] !== '{') break;
				const end = groupEnd(open, limit);
				if (end < 0) break;
				position = skipOptions(end, limit, '[', 1);
				open = skipSpace(position, limit);
			}
			if (text[open] !== '{') break;
			const end = groupEnd(open, limit);
			if (end < 0) break;
			readKeys(open, end, commented);
			found = true;
			position = end;
			if (!multiple) break;
			const next = skipSpace(position, limit);
			if (text[next] !== '[' && text[next] !== '{') break;
		}
		return found ? position : -1;
	};

	/** \begin{verbatim}…: where it ends, or -1 for another environment. */
	const skipVerbatim = (at: number): number => {
		const open = skipSpace(at, length);
		if (text[open] !== '{') return -1;
		const close = text.indexOf('}', open);
		if (close < 0) return -1;
		const environment = text.slice(open + 1, close).trim();
		if (!VERBATIM.has(environment)) return -1;
		const ending = `\\end{${environment}}`;
		const end = text.indexOf(ending, close);
		const bodyEnd = end < 0 ? length : end;
		if (environment.startsWith('filecontents')) {
			// A .bib the document writes for itself.
			const nameAt = skipSpace(skipOptions(close + 1, length, '[', 1), length);
			const nameEnd = text[nameAt] === '{' ? groupEnd(nameAt, length) : -1;
			const file = nameEnd > 0 ? text.slice(nameAt + 1, nameEnd - 1) : '';
			if (/\.bib$/i.test(file.trim())) {
				const body = text.slice(nameEnd, bodyEnd);
				for (const entry of parseBibDocument(body).entries) {
					if (entry.key) defined.push(entry.key);
				}
			}
		}
		return end < 0 ? length : end + ending.length;
	};

	let position = 0;
	while (position < length) {
		if (commentEnd >= 0 && position >= commentEnd) commentEnd = -1;
		const char = text[position];
		if (char === '%') {
			if (commentEnd < 0) commentEnd = lineEnd(position);
			position++;
			continue;
		}
		if (char !== '\\') {
			position++;
			continue;
		}
		let nameEnd = position + 1;
		while (isLetter(text[nameEnd])) nameEnd++;
		if (nameEnd === position + 1) {
			// \%, \\, \{: one character.
			position += 2;
			continue;
		}
		const name = text.slice(position + 1, nameEnd);
		const commented = commentEnd >= 0;
		const limit = commented ? commentEnd : length;

		if (name === 'verb') {
			// \verb|…|, \verb*|…|: up to the same character, on the line.
			let open = nameEnd;
			if (text[open] === '*') open++;
			const close = text.indexOf(text[open] ?? '', open + 1);
			const end = lineEnd(open);
			position = close < 0 || close > end ? end : close + 1;
			continue;
		}
		if (name === 'begin' && !commented) {
			const end = skipVerbatim(nameEnd);
			if (end >= 0) {
				position = end;
				continue;
			}
		}
		if (name === 'bibitem') {
			const open = skipSpace(skipOptions(nameEnd, limit, '[', 1), limit);
			const end = text[open] === '{' ? groupEnd(open, limit) : -1;
			if (end > 0) {
				const key = text.slice(open + 1, end - 1).trim();
				if (!commented && KEY.test(key)) defined.push(key);
				position = end;
				continue;
			}
		}
		if (isCitationCommand(name)) {
			const end = readCitation(name, nameEnd, limit, commented);
			if (end >= 0) {
				position = end;
				continue;
			}
		}
		position = nameEnd;
	}

	return { citations, everything, defined };
}

/** The changes that write `to` where `from` is cited, comments included. */
export function renameCitationChanges(
	text: string,
	from: string,
	to: string,
): BibChange[] {
	if (from === to) return [];
	return scanCitations(text)
		.citations.filter((citation) => citation.key === from)
		.map((citation) => ({
			from: citation.from,
			to: citation.to,
			insert: to,
		}));
}

// ---------------------------------------------------------------------------

export interface CitedKey {
	/** Citations outside comments. */
	count: number;
	files: Array<{ path: string; count: number }>;
}

/** What a project's LaTeX files cite and define. */
export interface ProjectCitations {
	/** The LaTeX files read. */
	files: string[];
	/** Each key cited outside comments. */
	cited: Map<string, CitedKey>;
	/** The files with \nocite{*}. */
	everything: string[];
	/** Keys given an entry elsewhere than in the .bib shown. */
	defined: Set<string>;
}

/**
 * The citations of LaTeX files, and the keys other .bib files (than the
 * one shown) give an entry.
 */
export function collectCitations(
	latex: Array<{ path: string; text: string }>,
	otherKeys: Iterable<string> = [],
): ProjectCitations {
	const cited = new Map<string, CitedKey>();
	const everything: string[] = [];
	const defined = new Set(otherKeys);
	const count = (key: string, path: string) => {
		let uses = cited.get(key);
		if (!uses) {
			uses = { count: 0, files: [] };
			cited.set(key, uses);
		}
		uses.count++;
		const file = uses.files.find((item) => item.path === path);
		if (file) file.count++;
		else uses.files.push({ path, count: 1 });
	};
	for (const { path, text } of latex) {
		const scan = scanCitations(text);
		if (scan.everything) everything.push(path);
		for (const key of scan.defined) defined.add(key);
		for (const citation of scan.citations) {
			if (!citation.commented) count(citation.key, path);
		}
	}
	return {
		files: latex.map((file) => file.path),
		cited,
		everything,
		defined,
	};
}
