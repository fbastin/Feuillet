// src/utils/htmlToLatex.ts
// Text copied with its formatting, from Word, Google Docs or a web page, as
// LaTeX, as Overleaf's visual editor pastes it: emphasis, headings, lists,
// links, tables and quotations, with LaTeX's special characters escaped.

const SPECIALS: Record<string, string> = {
	'\\': '\\textbackslash{}',
	'{': '\\{',
	'}': '\\}',
	$: '\\$',
	'&': '\\&',
	'#': '\\#',
	'%': '\\%',
	_: '\\_',
	'^': '\\^{}',
	'~': '\\~{}',
};

/** Text with LaTeX's special characters escaped. */
export const escapeLatex = (text: string): string =>
	text.replace(/[\\{}$&#%_^~]/g, (char) => SPECIALS[char]);

const escapeUrl = (url: string): string => url.replace(/[%#]/g, '\\$&');

const SKIPPED = new Set([
	'HEAD',
	'STYLE',
	'SCRIPT',
	'META',
	'TITLE',
	'LINK',
	'IMG',
	'SVG',
	'HR',
	'TEMPLATE',
]);

const HEADINGS: Record<string, string> = {
	H1: 'section',
	H2: 'subsection',
	H3: 'subsubsection',
	H4: 'paragraph',
	H5: 'paragraph',
	H6: 'paragraph',
};

const BLOCKS = new Set([
	'P',
	'DIV',
	'SECTION',
	'ARTICLE',
	'HEADER',
	'FOOTER',
	'MAIN',
	'ASIDE',
	'NAV',
	'FIGURE',
	'FIGCAPTION',
	'ADDRESS',
	'DL',
	'DT',
	'DD',
	'CENTER',
]);

const styleOf = (element: Element): CSSStyleDeclaration | null =>
	(element as HTMLElement).style ?? null;

const isBold = (element: Element): boolean => {
	const weight = styleOf(element)?.fontWeight ?? '';
	if (element.tagName === 'B' || element.tagName === 'STRONG') {
		// Google Docs wraps what it copies in a <b> that is not bold.
		return !(weight === 'normal' || weight === '400' || weight === 'lighter');
	}
	return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
};

const isItalic = (element: Element): boolean => {
	const style = styleOf(element)?.fontStyle ?? '';
	if (element.tagName === 'I' || element.tagName === 'EM') {
		return style !== 'normal';
	}
	return style === 'italic' || style === 'oblique';
};

const isUnderlined = (element: Element): boolean =>
	element.tagName === 'U' ||
	(element.tagName !== 'A' &&
		(styleOf(element)?.textDecoration ?? '').includes('underline'));

const verticalAlign = (element: Element): string =>
	element.tagName === 'SUP'
		? 'super'
		: element.tagName === 'SUB'
			? 'sub'
			: (styleOf(element)?.verticalAlign ?? '');

// Word marks its list paragraphs, and their bullets as text to ignore.
const isWordListItem = (element: Element): boolean =>
	element.tagName === 'P' &&
	/^MsoListParagraph/.test(element.getAttribute('class') ?? '');
const isWordIgnored = (element: Element): boolean =>
	/mso-list:\s*Ignore/i.test(element.getAttribute('style') ?? '');

const wrap = (command: string, content: string): string =>
	content.trim() ? `\\${command}{${content}}` : content;

const oneLine = (text: string): string =>
	text
		.replace(/\s*\n\s*/g, ' ')
		.replace(/ {2,}/g, ' ')
		.trim();

const block = (text: string): string => `\n\n${text.trim()}\n\n`;

function inline(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return escapeLatex(
			(node.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' '),
		);
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return '';
	const element = node as Element;
	const tag = element.tagName;
	if (SKIPPED.has(tag) || isWordIgnored(element)) return '';
	if (tag === 'BR') return '\\\\\n';
	if (tag === 'PRE') return block(verbatim(element));
	if (HEADINGS[tag]) {
		return block(`\\${HEADINGS[tag]}{${oneLine(children(element))}}`);
	}
	if (tag === 'UL' || tag === 'OL') return block(list(element));
	if (tag === 'TABLE') return block(table(element));
	if (tag === 'BLOCKQUOTE') {
		return block(`\\begin{quote}\n${children(element).trim()}\n\\end{quote}`);
	}
	if (tag === 'A') {
		const href = element.getAttribute('href') ?? '';
		const text = children(element);
		if (!/^(https?:|mailto:)/i.test(href)) return text;
		return text.trim() && oneLine(element.textContent ?? '') !== href
			? `\\href{${escapeUrl(href)}}{${text}}`
			: `\\url{${escapeUrl(href)}}`;
	}

	let content = children(element);
	if (tag === 'CODE' || tag === 'TT' || tag === 'KBD' || tag === 'SAMP') {
		content = wrap('texttt', content);
	}
	if (verticalAlign(element) === 'super')
		content = wrap('textsuperscript', content);
	if (verticalAlign(element) === 'sub')
		content = wrap('textsubscript', content);
	if (isUnderlined(element)) content = wrap('underline', content);
	if (isItalic(element)) content = wrap('textit', content);
	if (isBold(element)) content = wrap('textbf', content);
	return BLOCKS.has(tag) ? block(content) : content;
}

function children(element: Element): string {
	let text = '';
	let wordItems: string[] = [];
	const flushWordList = () => {
		if (wordItems.length === 0) return;
		text += block(
			`\\begin{itemize}\n${wordItems.map((item) => `  \\item ${item}`).join('\n')}\n\\end{itemize}`,
		);
		wordItems = [];
	};
	for (const child of Array.from(element.childNodes)) {
		if (
			child.nodeType === Node.ELEMENT_NODE &&
			isWordListItem(child as Element)
		) {
			wordItems.push(oneLine(children(child as Element)));
			continue;
		}
		if (child.nodeType === Node.ELEMENT_NODE) flushWordList();
		text += inline(child);
	}
	flushWordList();
	return text;
}

function list(element: Element): string {
	const environment = element.tagName === 'OL' ? 'enumerate' : 'itemize';
	const items = Array.from(element.children)
		.filter((child) => child.tagName === 'LI')
		.map((item) => {
			const body = children(item)
				.trim()
				.replace(/\n{3,}/g, '\n\n')
				.replace(/\n/g, '\n  ');
			return `  \\item ${body}`;
		});
	return `\\begin{${environment}}\n${items.join('\n')}\n\\end{${environment}}`;
}

function table(element: Element): string {
	const rows = Array.from(element.querySelectorAll('tr')).filter(
		(row) => row.closest('table') === element,
	);
	const cells = rows.map((row) =>
		Array.from(row.children)
			.filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH')
			.map((cell) => oneLine(children(cell).replace(/\\\\\n/g, ' '))),
	);
	const columns = Math.max(1, ...cells.map((row) => row.length));
	const header =
		rows[0] &&
		Array.from(rows[0].children).every((cell) => cell.tagName === 'TH');
	const lines = cells.map((row) => {
		const padded = [...row, ...Array(columns - row.length).fill('')];
		return `  ${padded.join(' & ')} \\\\`;
	});
	if (header && lines.length > 1) lines.splice(1, 0, '  \\hline');
	return `\\begin{tabular}{${'l'.repeat(columns)}}\n  \\hline\n${lines.join('\n')}\n  \\hline\n\\end{tabular}`;
}

function verbatim(element: Element): string {
	return `\\begin{verbatim}\n${(element.textContent ?? '').replace(/\n$/, '')}\n\\end{verbatim}`;
}

/**
 * The LaTeX for formatted text copied from elsewhere, or null when there is
 * nothing to gain over pasting its plain text: no formatting and no
 * character to escape, only code, or no text at all.
 */
export function htmlToLatex(html: string): string | null {
	if (!html.trim()) return null;
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const body = doc.body;
	if (!body || !(body.textContent ?? '').trim()) return null;

	// Code is pasted as it is.
	const meaningful = Array.from(body.children).filter(
		(child) => !SKIPPED.has(child.tagName),
	);
	if (
		meaningful.length > 0 &&
		meaningful.every(
			(child) => child.tagName === 'PRE' || child.tagName === 'CODE',
		)
	) {
		return null;
	}

	// A space left by the markup starts a line; indentation is two.
	const latex = children(body)
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n (?=\S)/g, '\n')
		.replace(/\\\\\s*(\n\n|$)/g, '$1')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	if (!latex) return null;
	return /\\[A-Za-z]|\\[{}$&#%_]|\\\^|\\~|\\\\/.test(latex) ? latex : null;
}
