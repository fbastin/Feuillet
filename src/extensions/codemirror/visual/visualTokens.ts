// src/extensions/codemirror/visual/visualTokens.ts
// What the visual editor shows differently in a LaTeX document: a scan of
// its text into ranges (headings, bold text, list items, formulas...), each
// with the parts of markup to hide. Pure text in, ranges out, so that it can
// be tested without an editor.

export type HeadingLevel = 0 | 1 | 2 | 3 | 4;
export type FormatStyle =
	| 'bold'
	| 'italic'
	| 'underline'
	| 'mono'
	| 'smallcaps'
	| 'caption';
export type ChipStyle = 'cite' | 'ref' | 'label';

interface Range {
	from: number;
	to: number;
}

export type VisualToken =
	| (Range & { kind: 'preamble'; lines: number })
	| (Range & { kind: 'hiddenLine' })
	| (Range & { kind: 'env' })
	| (Range & {
			kind: 'heading';
			level: HeadingLevel;
			open: Range;
			close: Range;
	  })
	| (Range & { kind: 'format'; style: FormatStyle; open: Range; close: Range })
	| (Range & { kind: 'link'; open: Range; close: Range })
	| (Range & { kind: 'item'; marker: string; level: number })
	| (Range & { kind: 'math'; tex: string; display: boolean })
	| (Range & { kind: 'chip'; style: ChipStyle; text: string })
	| (Range & { kind: 'escape'; text: string })
	| (Range & { kind: 'comment' })
	| (Range & { kind: 'image'; path: string })
	| (Range & {
			kind: 'title';
			title: string;
			author: string;
			date: string;
	  });

const HEADINGS: Record<string, HeadingLevel> = {
	part: 0,
	chapter: 0,
	section: 1,
	subsection: 2,
	subsubsection: 3,
	paragraph: 4,
};

const FORMATS: Record<string, FormatStyle> = {
	textbf: 'bold',
	textit: 'italic',
	emph: 'italic',
	textsl: 'italic',
	underline: 'underline',
	texttt: 'mono',
	textsc: 'smallcaps',
	caption: 'caption',
};

const CITES = new Set([
	'cite',
	'citep',
	'citet',
	'citeauthor',
	'citeyear',
	'parencite',
	'textcite',
	'autocite',
	'footcite',
	'nocite',
]);
const REFS = new Set(['ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref']);
const LISTS = new Set(['itemize', 'enumerate', 'description']);
const MATH_ENVS = new Set([
	'equation',
	'equation*',
	'align',
	'align*',
	'gather',
	'gather*',
	'multline',
	'multline*',
	'displaymath',
	'eqnarray',
	'eqnarray*',
	'math',
]);

// How far a brace or a formula may reach, so that a typo does not swallow
// the rest of the document.
const MAX_SPAN = 5000;

const lineStart = (text: string, pos: number) =>
	text.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (text: string, pos: number) => {
	const end = text.indexOf('\n', pos);
	return end === -1 ? text.length : end;
};

// The closing brace of the group opening at `open`, or -1.
export const matchBrace = (text: string, open: number): number => {
	let depth = 0;
	const limit = Math.min(text.length, open + MAX_SPAN);
	for (let i = open; i < limit; i++) {
		const char = text[i];
		if (char === '\\') {
			i++;
		} else if (char === '%') {
			i = lineEnd(text, i);
		} else if (char === '{') {
			depth++;
		} else if (char === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
};

// Past an optional argument [...] and spaces, if any.
const skipOptional = (text: string, pos: number): number => {
	let i = pos;
	while (text[i] === ' ' || text[i] === '\t') i++;
	if (text[i] !== '[') return pos;
	let depth = 0;
	for (let j = i; j < Math.min(text.length, i + MAX_SPAN); j++) {
		if (text[j] === '\\') j++;
		else if (text[j] === '[') depth++;
		else if (text[j] === ']' && --depth === 0) return j + 1;
	}
	return pos;
};

// The {argument} at `pos` (after optional spaces): its braces' positions.
const argumentAt = (
	text: string,
	pos: number,
): { open: number; close: number } | null => {
	let i = pos;
	while (text[i] === ' ' || text[i] === '\t') i++;
	if (text[i] !== '{') return null;
	const close = matchBrace(text, i);
	return close === -1 ? null : { open: i, close };
};

// Whether a line holds only `from`–`to` and spaces.
const aloneOnLine = (text: string, from: number, to: number) =>
	text.slice(lineStart(text, from), from).trim() === '' &&
	text.slice(to, lineEnd(text, to)).trim() === '';

const wholeLine = (text: string, from: number): Range => {
	const start = lineStart(text, from);
	const end = lineEnd(text, from);
	// With the line break before it, so that the line takes no room at all
	// and the next line keeps its own look (the first line takes the break
	// after it).
	return start > 0
		? { from: start - 1, to: end }
		: { from: start, to: end < text.length ? end + 1 : end };
};

// Readable text of a short LaTeX argument (title, author...).
export const plainText = (latex: string): string =>
	latex
		.replace(/\\today\b/g, new Date().toLocaleDateString())
		.replace(/\\and\b/g, ', ')
		.replace(/\\\\(\[[^\]]*\])?/g, ' ')
		.replace(/\\thanks\{[^}]*\}/g, '')
		.replace(/\\[a-zA-Z@]+\*?/g, '')
		.replace(/[{}~]/g, (char) => (char === '~' ? ' ' : ''))
		.replace(/\s+/g, ' ')
		.replace(/ ,/g, ',')
		.trim();

const preambleArgument = (preamble: string, command: string): string => {
	const match = new RegExp(`\\\\${command}\\s*(\\[[^\\]]*\\])?\\s*\\{`).exec(
		preamble,
	);
	if (!match) return '';
	const open = match.index + match[0].length - 1;
	const close = matchBrace(preamble, open);
	return close === -1 ? '' : plainText(preamble.slice(open + 1, close));
};

// A formula's text for KaTeX: labels and numbering commands are for the
// compiled document only.
const formulaTex = (tex: string): string =>
	tex
		.replace(/\\label\{[^}]*\}/g, '')
		.replace(/\\(nonumber|notag)\b/g, '')
		.trim();

/** Scans a LaTeX document into the ranges the visual editor shows. */
export function scanVisualTokens(text: string): VisualToken[] {
	const tokens: VisualToken[] = [];
	const lists: Array<{ kind: string; count: number }> = [];

	// The preamble folds with the \begin{document} line that ends it.
	const documentBegin = /\\begin\s*\{document\}/.exec(text);
	const preambleEnd =
		documentBegin && lineStart(text, documentBegin.index) > 0
			? lineEnd(text, documentBegin.index)
			: -1;
	if (documentBegin && preambleEnd !== -1) {
		tokens.push({
			kind: 'preamble',
			from: 0,
			to: preambleEnd,
			lines:
				text.slice(0, lineStart(text, documentBegin.index)).split('\n').length -
				1,
		});
	}
	const preambleText = documentBegin ? text.slice(0, documentBegin.index) : '';

	let i = 0;
	while (i < text.length) {
		const char = text[i];

		if (char === '%') {
			const end = lineEnd(text, i);
			tokens.push({ kind: 'comment', from: i, to: end });
			i = end;
			continue;
		}

		if (char === '$') {
			const display = text[i + 1] === '$';
			const delimiter = display ? '$$' : '$';
			let end = -1;
			for (
				let j = i + delimiter.length;
				j < Math.min(text.length, i + MAX_SPAN);
				j++
			) {
				if (text[j] === '\\') {
					j++;
					continue;
				}
				// An inline formula does not cross a blank line.
				if (!display && text[j] === '\n' && text[j + 1] === '\n') break;
				if (text.startsWith(delimiter, j)) {
					end = j;
					break;
				}
			}
			if (end === -1) {
				i += delimiter.length;
				continue;
			}
			tokens.push({
				kind: 'math',
				from: i,
				to: end + delimiter.length,
				tex: formulaTex(text.slice(i + delimiter.length, end)),
				display,
			});
			i = end + delimiter.length;
			continue;
		}

		// A tie is a space that does not break.
		if (char === '~') {
			tokens.push({ kind: 'escape', from: i, to: i + 1, text: '\u00a0' });
			i++;
			continue;
		}

		if (char !== '\\') {
			i++;
			continue;
		}

		const next = text[i + 1] ?? '';
		if ('%&_$#{}'.includes(next) && next) {
			tokens.push({ kind: 'escape', from: i, to: i + 2, text: next });
			i += 2;
			continue;
		}
		// Small spaces: \, \; \: and the negative \!.
		if (next && ',;:!'.includes(next)) {
			tokens.push({
				kind: 'escape',
				from: i,
				to: i + 2,
				text: next === '!' ? '' : '\u2009',
			});
			i += 2;
			continue;
		}
		if (next === '(' || next === '[') {
			const closer = next === '(' ? '\\)' : '\\]';
			const end = text.indexOf(closer, i + 2);
			if (end === -1 || end - i > MAX_SPAN) {
				i += 2;
				continue;
			}
			tokens.push({
				kind: 'math',
				from: i,
				to: end + 2,
				tex: formulaTex(text.slice(i + 2, end)),
				display: next === '[',
			});
			i = end + 2;
			continue;
		}

		const name = /^[a-zA-Z@]+\*?/.exec(text.slice(i + 1, i + 40))?.[0];
		if (!name) {
			i += 2;
			continue;
		}
		const base = name.replace(/\*$/, '');
		const afterName = i + 1 + name.length;

		if (base === 'begin' || base === 'end') {
			const argument = argumentAt(text, afterName);
			if (!argument) {
				i = afterName;
				continue;
			}
			const env = text.slice(argument.open + 1, argument.close).trim();
			const commandEnd = argument.close + 1;

			if (base === 'begin' && MATH_ENVS.has(env)) {
				const closing = new RegExp(
					`\\\\end\\s*\\{${env.replace('*', '\\*')}\\}`,
				).exec(text.slice(commandEnd, commandEnd + MAX_SPAN));
				if (closing) {
					const to = commandEnd + closing.index + closing[0].length;
					tokens.push({
						kind: 'math',
						from: i,
						to,
						tex: formulaTex(
							env.startsWith('equation') ||
								env === 'displaymath' ||
								env === 'math'
								? text.slice(commandEnd, commandEnd + closing.index)
								: text.slice(i, to).replace(/eqnarray/g, 'align'),
						),
						display: env !== 'math',
					});
					i = to;
					continue;
				}
			}

			if (env === 'document') {
				if (i > preambleEnd) {
					tokens.push({ kind: 'hiddenLine', ...wholeLine(text, i) });
				}
			} else if (LISTS.has(env)) {
				if (base === 'begin') lists.push({ kind: env, count: 0 });
				else lists.pop();
				tokens.push(
					aloneOnLine(text, i, commandEnd)
						? { kind: 'hiddenLine', ...wholeLine(text, i) }
						: { kind: 'env', from: i, to: commandEnd },
				);
			} else {
				tokens.push({ kind: 'env', from: i, to: commandEnd });
			}
			i = commandEnd;
			continue;
		}

		if (base === 'item') {
			const list = lists[lists.length - 1];
			let to = afterName;
			let marker = '•';
			const optionalEnd = skipOptional(text, afterName);
			if (optionalEnd !== afterName) {
				const open = text.indexOf('[', afterName);
				marker = plainText(text.slice(open + 1, optionalEnd - 1));
				to = optionalEnd;
			} else if (list?.kind === 'enumerate') {
				list.count++;
				marker = `${list.count}.`;
			}
			if (text[to] === ' ') to++;
			tokens.push({
				kind: 'item',
				from: i,
				to,
				marker,
				level: Math.max(1, lists.length),
			});
			i = to;
			continue;
		}

		if (
			base in HEADINGS ||
			base in FORMATS ||
			base === 'href' ||
			base === 'url'
		) {
			const start = skipOptional(text, afterName);
			let argument = argumentAt(text, start);
			let openTo = argument ? argument.open + 1 : start;
			if (argument && base === 'href') {
				// \href{url}{text}: the text shows, the address does not.
				const label = argumentAt(text, argument.close + 1);
				if (label) {
					openTo = label.open + 1;
					argument = label;
				} else {
					argument = null;
				}
			}
			if (!argument) {
				i = afterName;
				continue;
			}
			const open = { from: i, to: openTo };
			const close = { from: argument.close, to: argument.close + 1 };
			const range = { from: i, to: argument.close + 1 };
			if (base in HEADINGS) {
				tokens.push({
					kind: 'heading',
					level: HEADINGS[base],
					...range,
					open,
					close,
				});
			} else if (base in FORMATS) {
				tokens.push({
					kind: 'format',
					style: FORMATS[base],
					...range,
					open,
					close,
				});
			} else {
				tokens.push({ kind: 'link', ...range, open, close });
			}
			// The argument may hold more to show (bold text in a heading...).
			i = openTo;
			continue;
		}

		if (CITES.has(base) || REFS.has(base) || base === 'label') {
			const argument = argumentAt(
				text,
				skipOptional(text, skipOptional(text, afterName)),
			);
			if (!argument) {
				i = afterName;
				continue;
			}
			const keys = text
				.slice(argument.open + 1, argument.close)
				.split(',')
				.map((key) => key.trim())
				.filter(Boolean)
				.join(', ');
			tokens.push({
				kind: 'chip',
				style: CITES.has(base) ? 'cite' : base === 'label' ? 'label' : 'ref',
				from: i,
				to: argument.close + 1,
				text: keys,
			});
			i = argument.close + 1;
			continue;
		}

		if (base === 'includegraphics') {
			const argument = argumentAt(text, skipOptional(text, afterName));
			if (!argument) {
				i = afterName;
				continue;
			}
			tokens.push({
				kind: 'image',
				from: i,
				to: argument.close + 1,
				path: text.slice(argument.open + 1, argument.close).trim(),
			});
			i = argument.close + 1;
			continue;
		}

		if (base === 'maketitle') {
			tokens.push({
				kind: 'title',
				from: i,
				to: afterName,
				title: preambleArgument(preambleText, 'title'),
				author: preambleArgument(preambleText, 'author'),
				date: preambleArgument(preambleText, 'date'),
			});
			i = afterName;
			continue;
		}

		i = afterName;
	}

	return tokens;
}
