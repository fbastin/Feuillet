// src/utils/citationFormats.ts
// The citations of Typst and Markdown (Pandoc) documents, as
// src/utils/latexCitations.ts reads LaTeX's: each key with where it is
// written, to tell which entries of a .bib are cited and to rename a key
// where it is cited.
// - Typst: @key, #cite(<key>), #cite("key"); « @name » is a reference to a
//   label when the document has <name>, as Typst reads it, so the labels
//   are given too; #bibliography(..., full: true) lists every entry.
// - Markdown: Pandoc's [@key, p. 3], [-@key], @key in the text, @{key}, and
//   the front matter's nocite (@* for every entry); Quarto's and
//   pandoc-crossref's @fig-…, @sec:… are cross-references. A file is read
//   only when it is a Pandoc document with citations: a front matter that
//   names a bibliography, a style or nocite, or a citation in brackets (a
//   README's or a CHANGELOG's @name is none).
// Comments, code and raw text hold no citation.
import type { Citation, CitationScan } from './latexCitations';

export type CitationFormat = 'latex' | 'typst' | 'markdown';

/** The format a file's citations are read in, from its name, or null. */
export function citationFormatOf(path: string): CitationFormat | null {
	if (/\.(tex|ltx)$/i.test(path)) return 'latex';
	if (/\.typ$/i.test(path)) return 'typst';
	if (/\.(md|markdown|qmd|rmd)$/i.test(path)) return 'markdown';
	return null;
}

const lineEnd = (text: string, at: number) => {
	const end = text.indexOf('\n', at);
	return end < 0 ? text.length : end;
};

/** Past a run of backticks opening raw text or code, and its closing. */
function skipBackticks(text: string, at: number): number {
	let count = 0;
	while (text[at + count] === '`') count++;
	const fence = '`'.repeat(count);
	const close = text.indexOf(fence, at + count);
	return close < 0 ? text.length : close + count;
}

/** The character before `at`, spaces and line breaks aside. */
const previousNonSpace = (text: string, at: number): string => {
	let i = at - 1;
	while (i >= 0 && /\s/.test(text[i])) i--;
	return i >= 0 ? text[i] : '';
};

// ---------------------------------------------------------------------------
// Typst

export interface TypstScan extends CitationScan {
	/** The labels the text defines: <name>. */
	labels: string[];
	/** The citations that are references, @name: a label's, if it has one. */
	references: Set<Citation>;
}

// A label's name: letters, digits, _ - . :, not ending with . or :.
const TYPST_NAME = /^[\p{L}\p{N}_\-.:]+/u;
const typstName = (text: string, at: number): string => {
	const name = TYPST_NAME.exec(text.slice(at, at + 200))?.[0] ?? '';
	return name.replace(/[.:]+$/, '');
};

export function scanTypstCitations(text: string): TypstScan {
	const citations: Citation[] = [];
	const references = new Set<Citation>();
	const labels: string[] = [];
	let everything = false;
	let math = false;
	const length = text.length;
	let i = 0;
	while (i < length) {
		const char = text[i];
		if (char === '\\') {
			i += 2;
			continue;
		}
		if (char === '/' && text[i + 1] === '/') {
			i = lineEnd(text, i);
			continue;
		}
		if (char === '/' && text[i + 1] === '*') {
			const close = text.indexOf('*/', i + 2);
			i = close < 0 ? length : close + 2;
			continue;
		}
		if (char === '`') {
			i = skipBackticks(text, i);
			continue;
		}
		// A string of code: after ( , = : + [ {, where markup's straight
		// quotes would not stand.
		if (char === '"' && /[(,=:+[{]/.test(previousNonSpace(text, i))) {
			let end = i + 1;
			while (end < length && text[end] !== '"' && text[end] !== '\n') {
				end += text[end] === '\\' ? 2 : 1;
			}
			i = end + 1;
			continue;
		}
		if (char === '$') {
			math = !math;
			i++;
			continue;
		}
		if (math) {
			i++;
			continue;
		}
		if (char === '@' && !/[\p{L}\p{N}_]/u.test(text[i - 1] ?? '')) {
			const name = typstName(text, i + 1);
			if (name) {
				const citation = {
					key: name,
					from: i + 1,
					to: i + 1 + name.length,
					commented: false,
				};
				citations.push(citation);
				references.add(citation);
				i += 1 + name.length;
				continue;
			}
		}
		if (
			char === 'c' &&
			text.startsWith('cite(', i) &&
			!/[\p{L}\p{N}_-]/u.test(text[i - 1] ?? '')
		) {
			// cite(<key>), cite("key"), cite(label("key")).
			let at = i + 5;
			while (text[at] === ' ') at++;
			if (text.startsWith('label(', at)) {
				at += 6;
				while (text[at] === ' ') at++;
			}
			const open = text[at];
			const close = open === '<' ? '>' : open === '"' ? '"' : '';
			if (close) {
				const end = text.indexOf(close, at + 1);
				const key = end < 0 ? '' : text.slice(at + 1, end);
				if (key && /^[\p{L}\p{N}_\-.:]+$/u.test(key)) {
					citations.push({
						key,
						from: at + 1,
						to: end,
						commented: false,
					});
					i = end + 1;
					continue;
				}
			}
		}
		if (
			char === 'b' &&
			text.startsWith('bibliography(', i) &&
			!/[\p{L}\p{N}_-]/u.test(text[i - 1] ?? '')
		) {
			const close = text.indexOf(')', i);
			const call = text.slice(i, close < 0 ? length : close);
			if (/\bfull\s*:\s*true\b/.test(call)) everything = true;
		}
		if (char === '<') {
			const name = typstName(text, i + 1);
			if (name && text[i + 1 + name.length] === '>') {
				labels.push(name);
				i += name.length + 2;
				continue;
			}
		}
		i++;
	}
	return { citations, everything, defined: [], labels, references };
}

// ---------------------------------------------------------------------------
// Markdown

// Pandoc: a key begins with a letter, a digit or _, then letters, digits,
// _ and inner punctuation; or anything in braces, @{key}.
const PANDOC_KEY = /^[\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~/]*/u;
const TRAILING = /[:.#$%&\-+?<>~/]+$/;
// Cross-references of Quarto (@fig-x) and pandoc-crossref (@fig:x).
const CROSS_REFERENCE =
	/^(fig|tbl|sec|eq|lst|thm|lem|cor|prp|cnj|def|exm|exr|sol|rem)[-:]/i;
const FRONT_MATTER_KEYS =
	/^(bibliography|references|csl|nocite|citation-style|link-citations)\s*:/m;
const BRACKETED_CITATION = /\[[^\]\n]*-?@[\p{L}\p{N}_{]/u;

/** The Pandoc citations of a Markdown text, or null for another file. */
export function scanMarkdownCitations(text: string): CitationScan | null {
	const citations: Citation[] = [];
	let everything = false;
	let start = 0;
	let pandoc = false;
	// The front matter: its nocite cites; its keys tell a Pandoc document.
	const front =
		/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
	if (front) {
		pandoc = FRONT_MATTER_KEYS.test(front[1]);
		const nocite = /^nocite\s*:([\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(front[1]);
		if (nocite) {
			const offset =
				(front.index ?? 0) + front[0].indexOf(front[1]) + nocite.index;
			readAts(text, offset, offset + nocite[0].length, citations, () => {
				everything = true;
			});
		}
		start = front[0].length;
	}
	if (
		!pandoc &&
		!BRACKETED_CITATION.test(text.slice(start).replace(/`[^`\n]*`/g, ''))
	) {
		return null;
	}

	const length = text.length;
	let i = start;
	let lineStart = true;
	while (i < length) {
		const char = text[i];
		// A fenced code block: ``` or ~~~ at a line's start.
		if (lineStart) {
			const fence = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(text.slice(i, i + 40));
			if (fence) {
				const marker = fence[1];
				let at = lineEnd(text, i) + 1;
				for (;;) {
					if (at >= length) break;
					const line = text.slice(at, lineEnd(text, at));
					if (line.trimStart().startsWith(marker)) {
						at = lineEnd(text, at) + 1;
						break;
					}
					at = lineEnd(text, at) + 1;
				}
				i = at;
				continue;
			}
		}
		lineStart = char === '\n';
		if (char === '\\') {
			i += 2;
			continue;
		}
		if (char === '`') {
			i = skipBackticks(text, i);
			continue;
		}
		if (text.startsWith('<!--', i)) {
			const close = text.indexOf('-->', i + 4);
			i = close < 0 ? length : close + 3;
			continue;
		}
		if (char === '@') {
			const read = readCitation(text, i);
			if (read) {
				citations.push(read);
				i = read.to;
				continue;
			}
		}
		i++;
	}
	return { citations, everything, defined: [] };
}

/** The citation an @ at `at` starts, if it does. */
function readCitation(text: string, at: number): Citation | null {
	// Not an address: alice@example.org.
	if (/[\p{L}\p{N}_.]/u.test(text[at - 1] ?? '')) return null;
	if (text[at + 1] === '{') {
		const close = text.indexOf('}', at + 2);
		const key = close < 0 ? '' : text.slice(at + 2, close);
		if (!key || /[{}\n]/.test(key)) return null;
		return { key, from: at + 2, to: close, commented: false };
	}
	const key = (
		PANDOC_KEY.exec(text.slice(at + 1, at + 300))?.[0] ?? ''
	).replace(TRAILING, '');
	if (!key || CROSS_REFERENCE.test(key)) return null;
	return { key, from: at + 1, to: at + 1 + key.length, commented: false };
}

/** The @keys between `from` and `to` (a front matter's nocite). */
function readAts(
	text: string,
	from: number,
	to: number,
	citations: Citation[],
	all: () => void,
) {
	for (let at = text.indexOf('@', from); at >= 0 && at < to; ) {
		if (text[at + 1] === '*') all();
		else {
			const read = readCitation(text, at);
			if (read) citations.push(read);
		}
		at = text.indexOf('@', at + 1);
	}
}
