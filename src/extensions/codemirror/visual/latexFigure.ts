// src/extensions/codemirror/visual/latexFigure.ts
// Figures as Overleaf's figure toolbar edits them: the image of a figure,
// its width, its caption and its label, each changed in the LaTeX it
// concerns only.
import { matchBrace } from './visualTokens';

export interface FigureChange {
	from: number;
	to: number;
	insert: string;
}

/** A command of the figure, such as \caption{...}, and its argument. */
export interface FigureCommand {
	from: number;
	to: number;
	argument: string;
}

export interface FigureGraphics {
	from: number;
	to: number;
	/** The options in brackets, or where they would go. */
	optionsFrom: number;
	optionsTo: number;
	pathFrom: number;
	pathTo: number;
	path: string;
	/** The part of the line it takes, when its width is given that way. */
	width: number | null;
}

export interface LatexFigure {
	env: string;
	from: number;
	to: number;
	graphics: FigureGraphics;
	caption: FigureCommand | null;
	label: FigureCommand | null;
	/** The indentation of the image's line. */
	indent: string;
}

const lineStart = (text: string, pos: number) =>
	text.lastIndexOf('\n', pos - 1) + 1;

const lineEnd = (text: string, pos: number) => {
	const end = text.indexOf('\n', pos);
	return end === -1 ? text.length : end;
};

// Whether the character at `pos` follows an odd number of backslashes.
const escaped = (text: string, pos: number) => {
	let count = 0;
	for (let i = pos - 1; i >= 0 && text[i] === '\\'; i--) count++;
	return count % 2 === 1;
};

const inComment = (text: string, pos: number) => {
	for (let i = lineStart(text, pos); i < pos; i++) {
		if (text[i] === '%' && !escaped(text, i)) return true;
	}
	return false;
};

const skipSpaces = (text: string, pos: number) => {
	let i = pos;
	while (text[i] === ' ' || text[i] === '\t') i++;
	return i;
};

// The end of [...] at `pos`, braces included, or -1.
const optionalEnd = (text: string, pos: number) => {
	let depth = 0;
	for (let i = pos + 1; i < text.length; i++) {
		const char = text[i];
		if (char === '\\') i++;
		else if (char === '{') depth++;
		else if (char === '}') depth--;
		else if (char === ']' && depth === 0) return i + 1;
	}
	return -1;
};

// A command's argument: an optional [...] skipped, then {...}.
const argumentOf = (text: string, pos: number) => {
	let i = skipSpaces(text, pos);
	if (text[i] === '[') {
		const end = optionalEnd(text, i);
		if (end === -1) return null;
		i = skipSpaces(text, end);
	}
	if (text[i] !== '{') return null;
	const close = matchBrace(text, i);
	return close === -1 ? null : { open: i, close };
};

interface OptionEntry {
	from: number;
	to: number;
	key: string;
	valueFrom: number;
	valueTo: number;
}

// The key=value entries of [...], where they are.
const optionEntries = (text: string, from: number, to: number) => {
	const entries: OptionEntry[] = [];
	if (to <= from) return entries;
	const add = (start: number, end: number) => {
		let s = start;
		let e = end;
		while (s < e && /\s/.test(text[s])) s++;
		while (e > s && /\s/.test(text[e - 1])) e--;
		if (s === e) return;
		const equals = text.indexOf('=', s);
		const hasValue = equals !== -1 && equals < e;
		let valueFrom = hasValue ? equals + 1 : e;
		while (valueFrom < e && /\s/.test(text[valueFrom])) valueFrom++;
		entries.push({
			from: s,
			to: e,
			key: text.slice(s, hasValue ? equals : e).trim(),
			valueFrom,
			valueTo: e,
		});
	};
	let depth = 0;
	let start = from + 1;
	for (let i = from + 1; i < to - 1; i++) {
		const char = text[i];
		if (char === '\\') i++;
		else if (char === '{') depth++;
		else if (char === '}') depth--;
		else if (char === ',' && depth === 0) {
			add(start, i);
			start = i + 1;
		}
	}
	add(start, to - 1);
	return entries;
};

const FRACTION = /^([\d.]*)\s*\\(linewidth|textwidth|columnwidth)$/;
const SIZE_KEYS = new Set(['width', 'height', 'totalheight', 'scale']);

const widthOf = (text: string, entries: OptionEntry[]): number | null => {
	const width = entries.find((entry) => entry.key === 'width');
	if (!width) return null;
	const match = FRACTION.exec(text.slice(width.valueFrom, width.valueTo));
	if (!match) return null;
	const fraction = Number(match[1] || '1');
	return fraction > 0 &&
		!entries.some((e) => SIZE_KEYS.has(e.key) && e !== width)
		? fraction
		: null;
};

const COMMANDS = /\\(includegraphics|caption|label)(?![a-zA-Z@])\*?/g;

/**
 * The figure whose \begin is at `from`, if it holds one image whose path
 * and options can be read.
 */
export const parseLatexFigure = (
	text: string,
	from: number,
): LatexFigure | null => {
	const begin = /^\\begin\s*\{(figure\*?)\}/.exec(text.slice(from, from + 40));
	if (!begin || inComment(text, from)) return null;
	const env = begin[1];
	let bodyFrom = from + begin[0].length;
	if (text[skipSpaces(text, bodyFrom)] === '[') {
		const end = optionalEnd(text, skipSpaces(text, bodyFrom));
		if (end !== -1) bodyFrom = end;
	}
	const endPattern = new RegExp(
		`\\\\end\\s*\\{${env.replace('*', '\\*')}\\}`,
		'g',
	);
	endPattern.lastIndex = bodyFrom;
	let end = endPattern.exec(text);
	while (end && inComment(text, end.index)) end = endPattern.exec(text);
	if (!end) return null;

	let graphics: FigureGraphics | null = null;
	let images = 0;
	let caption: FigureCommand | null = null;
	let label: FigureCommand | null = null;
	COMMANDS.lastIndex = bodyFrom;
	for (
		let match = COMMANDS.exec(text);
		match && match.index < end.index;
		match = COMMANDS.exec(text)
	) {
		if (escaped(text, match.index) || inComment(text, match.index)) continue;
		const afterName = match.index + match[0].length;
		if (match[1] === 'includegraphics') {
			images++;
			const optionsFrom = skipSpaces(text, afterName);
			const optionsTo =
				text[optionsFrom] === '['
					? optionalEnd(text, optionsFrom)
					: optionsFrom;
			const argument = argumentOf(text, afterName);
			if (optionsTo === -1 || !argument) return null;
			const entries = optionEntries(text, optionsFrom, optionsTo);
			graphics = {
				from: match.index,
				to: argument.close + 1,
				optionsFrom: optionsTo === optionsFrom ? afterName : optionsFrom,
				optionsTo: optionsTo === optionsFrom ? afterName : optionsTo,
				pathFrom: argument.open + 1,
				pathTo: argument.close,
				path: text.slice(argument.open + 1, argument.close).trim(),
				width: widthOf(text, entries),
			};
			continue;
		}
		const argument = argumentOf(text, afterName);
		if (!argument) continue;
		const command = {
			from: match.index,
			to: argument.close + 1,
			argument: text.slice(argument.open + 1, argument.close),
		};
		if (match[1] === 'caption') caption ??= command;
		else label ??= command;
	}
	if (images !== 1 || !graphics) return null;
	const start = lineStart(text, graphics.from);
	return {
		env,
		from,
		to: end.index + end[0].length,
		graphics,
		caption,
		label,
		indent: /^[ \t]*/.exec(text.slice(start, graphics.from))?.[0] ?? '',
	};
};

/** The figure around `pos`, if any. */
export const findFigureAt = (text: string, pos: number): LatexFigure | null => {
	for (
		let at = text.lastIndexOf('\\begin', pos);
		at !== -1;
		at = text.lastIndexOf('\\begin', at - 1)
	) {
		if (!/^\\begin\s*\{figure\*?\}/.test(text.slice(at, at + 40))) continue;
		if (inComment(text, at)) continue;
		const figure = parseLatexFigure(text, at);
		return figure && pos <= figure.to ? figure : null;
	}
	return null;
};

const widthValue = (width: number, unit = 'linewidth') =>
	`${width >= 1 ? '' : String(Number(width.toFixed(2)))}\\${unit}`;

/** Makes the image of a figure as wide as a part of the line. */
export const setFigureWidth = (
	text: string,
	figure: LatexFigure,
	width: number,
): FigureChange[] => {
	const { optionsFrom, optionsTo } = figure.graphics;
	const entries = optionEntries(text, optionsFrom, optionsTo);
	const current = entries.find((entry) => entry.key === 'width');
	if (current) {
		const unit = FRACTION.exec(text.slice(current.valueFrom, current.valueTo));
		return [
			{
				from: current.valueFrom,
				to: current.valueTo,
				insert: widthValue(width, unit?.[2]),
			},
		];
	}
	const entry = `width=${widthValue(width)}`;
	// A scale would apply on top of the width.
	const scale = entries.find((e) => e.key === 'scale');
	if (scale) return [{ from: scale.from, to: scale.to, insert: entry }];
	if (optionsTo === optionsFrom) {
		return [{ from: optionsFrom, to: optionsFrom, insert: `[${entry}]` }];
	}
	return [
		{
			from: optionsFrom + 1,
			to: optionsFrom + 1,
			insert: entries.length ? `${entry}, ` : entry,
		},
	];
};

/** Puts another image in a figure. */
export const setFigureImage = (
	figure: LatexFigure,
	path: string,
): FigureChange[] => [
	{ from: figure.graphics.pathFrom, to: figure.graphics.pathTo, insert: path },
];

// Takes commands away, with their line when nothing else is on it.
const removal = (text: string, from: number, to: number): FigureChange => {
	const start = lineStart(text, from);
	const end = lineEnd(text, to);
	if (
		text.slice(start, from).trim() !== '' ||
		text.slice(to, end).trim() !== ''
	) {
		return { from, to, insert: '' };
	}
	return start > 0
		? { from: start - 1, to: end, insert: '' }
		: { from: start, to: Math.min(end + 1, text.length), insert: '' };
};

/**
 * Gives a figure a caption and a label, or takes them away: a string keeps
 * the one the figure has, or adds one with that text; null removes it.
 */
export const setFigureParts = (
	text: string,
	figure: LatexFigure,
	parts: { caption: string | null; label: string | null },
): FigureChange[] => {
	const { caption, label } = figure;
	const changes: FigureChange[] = [];
	const removeCaption = parts.caption === null && caption !== null;
	// A label written in the caption goes with it.
	const labelLost =
		removeCaption &&
		label !== null &&
		label.from >= caption.from &&
		label.to <= caption.to;
	const removeLabel = parts.label === null && label !== null && !labelLost;
	if (
		removeCaption &&
		removeLabel &&
		lineStart(text, caption.from) === lineStart(text, label.from)
	) {
		changes.push(
			removal(
				text,
				Math.min(caption.from, label.from),
				Math.max(caption.to, label.to),
			),
		);
	} else {
		if (removeCaption) changes.push(removal(text, caption.from, caption.to));
		if (removeLabel) changes.push(removal(text, label.from, label.to));
	}

	const line = (command: string) => `\n${figure.indent}${command}`;
	const addLabel = parts.label !== null && (label === null || labelLost);
	const labelLine = addLabel ? line(`\\label{${parts.label}}`) : '';
	if (parts.caption !== null && caption !== null) {
		// After the caption, which gives the number the label refers to.
		const at = lineEnd(text, caption.to);
		if (labelLine) changes.push({ from: at, to: at, insert: labelLine });
	} else {
		const at = lineEnd(text, figure.graphics.to);
		const insert =
			(parts.caption !== null ? line(`\\caption{${parts.caption}}`) : '') +
			labelLine;
		if (insert) changes.push({ from: at, to: at, insert });
	}
	return changes;
};

/** Takes a figure away, with its lines. */
export const deleteFigure = (text: string, figure: LatexFigure): FigureChange =>
	removal(text, figure.from, figure.to);
