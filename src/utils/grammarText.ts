// src/utils/grammarText.ts
// A paragraph of LaTeX or Typst as LanguageTool reads it: its prose as text,
// the rest (commands, formulas, references, comments) as markup with what it
// reads as, so that `$x$` reads as a word, `\ref{…}` as a number, `\item` as
// a list item and a command as nothing. The parts put together are the
// paragraph itself, so the places LanguageTool gives are the document's.

export type GrammarFormat = 'latex' | 'typst';

export interface AnnotationPart {
	text?: string;
	markup?: string;
	interpretAs?: string;
}

export interface TextRange {
	from: number;
	to: number;
}

/** A paragraph to check: its place in the document and its parts. */
export interface GrammarChunk extends TextRange {
	text: string;
	annotation: AnnotationPart[];
}

// What reads differently inside LaTeX prose: TeX quotes, ties and dashes.
const LATEX_TEXT_MARKUP = /``|''|~|---|--/g;
const LATEX_TEXT_READING: Record<string, string> = {
	'``': '"',
	"''": '"',
	'~': ' ',
	'---': '—',
	'--': '–',
};

const BLANK_LINE = /\n[ \t]*\n/;
const LATEX_BLOCK =
	/\\(?:begin|end|(?:sub)*section|chapter|part|paragraph|subparagraph|caption|maketitle|par|footnote)\b|\\\\/;
const LATEX_MATH =
	/\$|\\\(|\\\[|\\begin\{(?:equation|align|gather|multline|eqnarray|math|displaymath)\*?\}/;
const LATEX_CITE = /\\[A-Za-z]*cite[A-Za-z]*\*?\s*(?:\[[^\]]*\]\s*)*\{/;
const LATEX_REF = /\\(?:[A-Za-z]*ref|eqref|autoref|cref|Cref|pageref)\*?\s*\{/;
const LATEX_LOGO: Record<string, string> = {
	'\\LaTeX': 'LaTeX',
	'\\TeX': 'TeX',
	'\\BibTeX': 'BibTeX',
	'\\og': '« ',
	'\\fg': ' »',
};

/** What a piece of LaTeX markup reads as, inside a paragraph. */
export const latexReading = (markup: string): string => {
	if (/\\item\b/.test(markup)) return '\n\n- ';
	// A formula reads as a word, even shown apart: the sentence goes on.
	if (
		LATEX_MATH.test(markup) &&
		!/\\(?:(?:sub)*section|chapter|caption)\b/.test(markup)
	) {
		return 'x';
	}
	if (BLANK_LINE.test(markup) || LATEX_BLOCK.test(markup)) return '\n\n';
	if (LATEX_CITE.test(markup)) return '[1]';
	if (LATEX_REF.test(markup)) return '1';
	const logo = /^\\[A-Za-z]+/.exec(markup.trim())?.[0];
	if (logo && LATEX_LOGO[logo]) return LATEX_LOGO[logo];
	if (/\n|\\[,;: ]|\\quad\b|\\qquad\b/.test(markup)) return ' ';
	return '';
};

/** What a piece of Typst markup reads as, inside a paragraph. */
export const typstReading = (markup: string): string => {
	if (/(?:^|\n)[ \t]*[-+][ \t]/.test(markup)) return '\n\n- ';
	if (BLANK_LINE.test(markup) || /(?:^|\n)[ \t]*=+[ \t]/.test(markup)) {
		return '\n\n';
	}
	if (markup.includes('$')) return 'x';
	if (/@[\w:.-]/.test(markup)) return '1';
	if (/\n|~/.test(markup)) return ' ';
	return '';
};

/**
 * The parts of `source`, whose prose is at `prose` (places in `source`):
 * text for the prose, markup for the rest. Put together, they are `source`.
 */
export function annotate(
	source: string,
	prose: TextRange[],
	format: GrammarFormat,
): AnnotationPart[] {
	const parts: AnnotationPart[] = [];
	const reading = format === 'typst' ? typstReading : latexReading;
	const markup = (piece: string, interpretAs = reading(piece)) => {
		if (!piece) return;
		const last = parts[parts.length - 1];
		// Pieces of markup that touch read as one.
		if (
			last?.markup !== undefined &&
			last.interpretAs === '' &&
			interpretAs === ''
		) {
			last.markup += piece;
			return;
		}
		parts.push({ markup: piece, interpretAs });
	};
	const text = (piece: string) => {
		if (!piece) return;
		if (format !== 'latex') {
			parts.push({ text: piece });
			return;
		}
		let at = 0;
		for (const match of piece.matchAll(LATEX_TEXT_MARKUP)) {
			if (match.index > at) parts.push({ text: piece.slice(at, match.index) });
			markup(match[0], LATEX_TEXT_READING[match[0]]);
			at = match.index + match[0].length;
		}
		if (at < piece.length) parts.push({ text: piece.slice(at) });
	};

	const ranges = prose
		.map(({ from, to }) => ({
			from: Math.max(0, from),
			to: Math.min(source.length, to),
		}))
		.filter(({ from, to }) => to > from)
		.sort((a, b) => a.from - b.from);
	let at = 0;
	for (const range of ranges) {
		if (range.to <= at) continue;
		const from = Math.max(range.from, at);
		markup(source.slice(at, from));
		text(source.slice(from, range.to));
		at = range.to;
	}
	markup(source.slice(at));
	return parts;
}

/** Whether a paragraph's parts hold words worth checking. */
export const hasWords = (parts: AnnotationPart[]): boolean =>
	parts.some((part) => part.text && /\p{L}{2}/u.test(part.text));

/**
 * The paragraphs of `text` that `[from, to]` touches: between blank lines,
 * and no longer than `maxLength` (cut at a line's end).
 */
export function paragraphsAround(
	text: string,
	from: number,
	to: number,
	maxLength = 4000,
): TextRange[] {
	const paragraphs: TextRange[] = [];
	const push = (start: number, end: number) => {
		if (end < from || start > to) return;
		for (let piece = start; piece < end; ) {
			let stop = Math.min(end, piece + maxLength);
			if (stop < end) {
				const line = text.lastIndexOf('\n', stop);
				if (line > piece) stop = line;
			}
			if (text.slice(piece, stop).trim()) {
				paragraphs.push({ from: piece, to: stop });
			}
			piece = stop;
		}
	};
	let start = 0;
	for (const separator of text.matchAll(/\n(?:[ \t]*\n)+/g)) {
		push(start, separator.index);
		start = separator.index + separator[0].length;
		if (start > to) return paragraphs;
	}
	push(start, text.length);
	return paragraphs;
}
