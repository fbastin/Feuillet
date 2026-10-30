// src/utils/latexCodeCheck.ts
// Overleaf's code check: mistakes in the structure of a LaTeX file, found
// while typing, before any compile. Environments, groups, math delimiters
// and \left...\right pair up; math does not run past a paragraph; commands
// of math mode stay in math. Comments, verbatim text, \iffalse blocks,
// definitions, and the arguments of commands that take names, paths or keys
// are not checked. Only this file is read: nothing here depends on the
// labels, citations or packages of the rest of the project.

export type CodeProblemKind =
	/** Opened here, never closed: `command`. */
	| 'unclosed'
	/** The environment `command` is closed by `closing`. */
	| 'closedBy'
	/** `command` has nothing to close. */
	| 'closesNothing'
	/** Math opened by `command` runs into a paragraph break. */
	| 'paragraphEnd'
	/** A blank line inside the math environment `command`. */
	| 'blankLineInMath'
	/** `command` outside math mode. */
	| 'mathOnly'
	/** `command` inside math mode. */
	| 'notAllowedInMath'
	/** The file has \documentclass but no `command`. */
	| 'missing';

export interface CodeProblem {
	from: number;
	to: number;
	severity: 'error' | 'warning';
	kind: CodeProblemKind;
	command: string;
	closing?: string;
}

type Mode = 'text' | 'math';

interface Opener {
	type: 'group' | 'env' | 'math' | 'left';
	from: number;
	to: number;
	command: string;
	name?: string;
	/** The mode inside. */
	mode: Mode;
	/** Inside drawings, where ^, _ and math symbols may be names. */
	lenient: boolean;
	/** For a group: the command it is an argument of. */
	argumentOf?: string | null;
	blankLineReported?: boolean;
}

const MAX_PROBLEMS = 100;

// Environments read as written, up to their \end.
const VERBATIM_ENVIRONMENTS = new Set([
	'verbatim',
	'verbatim*',
	'Verbatim',
	'Verbatim*',
	'BVerbatim',
	'LVerbatim',
	'semiverbatim',
	'lstlisting',
	'minted',
	'comment',
	'filecontents',
	'filecontents*',
	'luacode',
	'luacode*',
	'pycode',
	'sageblock',
	'sagesilent',
	'asy',
	'asydef',
	'gnuplot',
	'dot2tex',
]);

// Display math: not allowed inside math, no blank line inside.
const DISPLAY_MATH_ENVIRONMENTS = new Set([
	'equation',
	'equation*',
	'align',
	'align*',
	'alignat',
	'alignat*',
	'flalign',
	'flalign*',
	'gather',
	'gather*',
	'multline',
	'multline*',
	'eqnarray',
	'eqnarray*',
	'math',
	'displaymath',
	'dmath',
	'dmath*',
	'IEEEeqnarray',
	'IEEEeqnarray*',
]);

const MATH_ENVIRONMENTS = new Set([...DISPLAY_MATH_ENVIRONMENTS, 'tikzcd']);

// Text again, even inside math.
const TEXT_ENVIRONMENTS = new Set([
	'tabular',
	'tabular*',
	'tabularx',
	'tabulary',
	'longtable',
	'minipage',
]);

// Tables: how many arguments come before the rows, the last being the
// column specification, where >{$}l<{$} is allowed.
const TABLE_ARGUMENTS: Record<string, number> = {
	tabular: 1,
	'tabular*': 2,
	tabularx: 2,
	tabulary: 2,
	xltabular: 2,
	array: 1,
	longtable: 1,
	supertabular: 1,
	tblr: 1,
	longtblr: 1,
};

const LENIENT_ENVIRONMENTS = new Set([
	'tikzpicture',
	'pgfpicture',
	'circuitikz',
	'tikzcd',
	'axis',
	'semilogxaxis',
	'semilogyaxis',
	'loglogaxis',
	'polaraxis',
	'groupplot',
	'forest',
	'pspicture',
]);

// Commands whose arguments are text, even inside math.
const TEXT_COMMANDS = new Set([
	'text',
	'textrm',
	'textit',
	'textbf',
	'textsf',
	'texttt',
	'textup',
	'textsl',
	'textsc',
	'textmd',
	'textnormal',
	'emph',
	'mbox',
	'hbox',
	'vbox',
	'fbox',
	'makebox',
	'framebox',
	'parbox',
	'raisebox',
	'colorbox',
	'fcolorbox',
	'intertext',
	'shortintertext',
	'tag',
]);

// Math-only commands that also work, or belong, outside math.
export const NOT_MATH_ONLY = new Set([
	'\\text',
	'\\allowdisplaybreaks',
	'\\cancel',
	'\\vdots',
]);

// Commands whose arguments are names, paths, keys or code: how many
// arguments in braces, optional ones in brackets aside.
const NAME_ARGUMENTS: Record<string, number> = {
	label: 1,
	ref: 1,
	eqref: 1,
	pageref: 1,
	autoref: 1,
	nameref: 1,
	cref: 1,
	Cref: 1,
	cpageref: 1,
	vref: 1,
	labelcref: 1,
	crefrange: 2,
	hyperref: 0,
	input: 1,
	include: 1,
	includeonly: 1,
	subfile: 1,
	import: 2,
	subimport: 2,
	includegraphics: 1,
	includepdf: 1,
	includesvg: 1,
	includestandalone: 1,
	graphicspath: 1,
	bibliography: 1,
	bibliographystyle: 1,
	addbibresource: 1,
	bibitem: 1,
	usepackage: 1,
	RequirePackage: 1,
	documentclass: 1,
	LoadClass: 1,
	PassOptionsToPackage: 2,
	PassOptionsToClass: 2,
	hypersetup: 1,
	lstset: 1,
	tikzset: 1,
	pgfplotsset: 1,
	sisetup: 1,
	captionsetup: 1,
	geometry: 1,
	usetikzlibrary: 1,
	usepgfplotslibrary: 1,
	definecolor: 3,
	colorlet: 2,
	lstinputlisting: 1,
	inputminted: 2,
	newcounter: 1,
	newacronym: 3,
	newglossaryentry: 2,
	gls: 1,
	Gls: 1,
	glspl: 1,
	Glspl: 1,
	acrshort: 1,
	acrlong: 1,
	acrfull: 1,
	index: 1,
	ce: 1,
	pu: 1,
	// siunitx: units are written with \per, \square, \sqrt...
	SI: 2,
	si: 1,
	unit: 1,
	qty: 2,
	num: 1,
	ang: 1,
	SIrange: 3,
	qtyrange: 3,
	numrange: 2,
	SIlist: 2,
	qtylist: 2,
	numlist: 1,
	tablenum: 1,
	DeclareSIUnit: 2,
	DeclareSourcemap: 1,
};

// Arguments read as written: % and # are not special there.
const RAW_ARGUMENTS = new Set(['url', 'path', 'nolinkurl', 'href']);

// Definitions: a name, then arguments that are code.
const DEFINITIONS = new Set([
	'newcolumntype',
	'newcommand',
	'renewcommand',
	'providecommand',
	'DeclareRobustCommand',
	'DeclareMathOperator',
	'DeclarePairedDelimiter',
	'DeclarePairedDelimiterX',
	'newenvironment',
	'renewenvironment',
	'NewDocumentCommand',
	'RenewDocumentCommand',
	'ProvideDocumentCommand',
	'DeclareDocumentCommand',
	'NewExpandableDocumentCommand',
	'NewDocumentEnvironment',
	'RenewDocumentEnvironment',
	'newrobustcmd',
	'renewrobustcmd',
]);

const TEX_DEFINITIONS = new Set(['def', 'gdef', 'edef', 'xdef']);

const isLetter = (char: string | undefined) =>
	char !== undefined && /[a-zA-Z@]/.test(char);

const lineEnd = (text: string, pos: number) => {
	const end = text.indexOf('\n', pos);
	return end === -1 ? text.length : end;
};

const skipSpaces = (text: string, pos: number) => {
	let i = pos;
	while (text[i] === ' ' || text[i] === '\t' || text[i] === '\r') i++;
	return i;
};

// Spaces and at most one line break: not a paragraph break.
const skipArgumentSpace = (text: string, pos: number) => {
	let i = skipSpaces(text, pos);
	if (text[i] === '\n') {
		const next = skipSpaces(text, i + 1);
		if (text[next] !== '\n') i = next;
	}
	return i;
};

/** The end of the group opening at `pos`, or -1 if it is not closed. */
const groupEnd = (text: string, pos: number, raw = false) => {
	let depth = 0;
	for (let i = pos; i < text.length; i++) {
		const char = text[i];
		if (char === '\\' && !raw) i++;
		else if (char === '%' && !raw) i = lineEnd(text, i);
		else if (char === '{') depth++;
		else if (char === '}' && --depth === 0) return i + 1;
	}
	return -1;
};

// The end of [...] at `pos` within the paragraph, or -1.
const optionEnd = (text: string, pos: number) => {
	let depth = 0;
	for (let i = pos + 1; i < text.length; i++) {
		const char = text[i];
		if (char === '\\') i++;
		else if (char === '{') depth++;
		else if (char === '}') depth--;
		else if (char === ']' && depth <= 0) return i + 1;
		else if (char === '\n' && text[skipSpaces(text, i + 1)] === '\n') return -1;
	}
	return -1;
};

// Skips a star and optional arguments.
const skipOptions = (text: string, pos: number) => {
	let i = text[pos] === '*' ? pos + 1 : pos;
	for (;;) {
		const next = skipArgumentSpace(text, i);
		if (text[next] !== '[') return i;
		const end = optionEnd(text, next);
		if (end === -1) return i;
		i = end;
	}
};

// Skips `count` arguments in braces, and the optional ones around them.
const skipArguments = (text: string, pos: number, count: number) => {
	let i = skipOptions(text, pos);
	for (let left = count; left > 0; left--) {
		const next = skipArgumentSpace(text, i);
		if (text[next] !== '{') return i;
		const end = groupEnd(text, next);
		if (end === -1) return i;
		i = skipOptions(text, end);
	}
	return i;
};

// Skips a control sequence name: \name, or {\name}.
const skipName = (text: string, pos: number) => {
	const i = skipArgumentSpace(text, pos);
	if (text[i] === '{') {
		const end = groupEnd(text, i);
		return end === -1 ? i : end;
	}
	if (text[i] !== '\\') return i;
	let j = i + 1;
	if (isLetter(text[j])) while (isLetter(text[j])) j++;
	else j++;
	return j;
};

// Skips a definition's name and every argument after it.
const skipDefinition = (text: string, pos: number) => {
	let i = skipName(text, text[pos] === '*' ? pos + 1 : pos);
	for (;;) {
		const next = skipArgumentSpace(text, i);
		const end =
			text[next] === '{'
				? groupEnd(text, next)
				: text[next] === '['
					? optionEnd(text, next)
					: -1;
		if (end === -1) return i;
		i = end;
	}
};

// \def\name#1#2{body}: the name, the parameters, the body.
const skipTexDefinition = (text: string, pos: number) => {
	const afterName = skipName(text, pos);
	const open = text.indexOf('{', afterName);
	if (open === -1 || text.slice(afterName, open).includes('\n\n')) {
		return afterName;
	}
	const end = groupEnd(text, open);
	return end === -1 ? afterName : end;
};

// \verb|...|, \lstinline{...}, \mintinline{lang}|...|.
const skipInlineVerbatim = (text: string, pos: number, command: string) => {
	let i = command === 'verb' && text[pos] === '*' ? pos + 1 : pos;
	if (command !== 'verb') i = skipOptions(text, i);
	if (command === 'mintinline') {
		if (text[i] !== '{') return i;
		const end = groupEnd(text, i, true);
		if (end === -1) return i;
		i = end;
	}
	const delimiter = text[i];
	if (delimiter === undefined || delimiter === '\n') return i;
	if (delimiter === '{' && command !== 'verb') {
		const end = groupEnd(text, i, true);
		return end === -1 ? lineEnd(text, i) : end;
	}
	const close = text.indexOf(delimiter, i + 1);
	const end = lineEnd(text, i);
	return close === -1 || close > end ? end : close + 1;
};

// What the file itself declares, read before checking it: verbatim
// environments and short verbatim characters of its own, and commands it
// defines, which are no longer those of LaTeX.
const declarations = (text: string) => {
	const verbatim = new Set<string>();
	const shortVerb = new Set<string>();
	const defined = new Set<string>();
	const named = (pattern: RegExp, add: (match: RegExpExecArray) => void) => {
		for (const match of text.matchAll(pattern)) add(match);
	};
	named(
		/\\(?:DefineVerbatimEnvironment|CustomVerbatimEnvironment|RecustomVerbatimEnvironment|lstnewenvironment|newtcblisting|NewTCBListing|DeclareTCBListing|excludecomment)\s*\{([^}]+)\}/g,
		(match) => verbatim.add(match[1].trim()),
	);
	named(/\\newminted\s*(?:\[([^\]]+)\])?\s*\{([^}]+)\}/g, (match) =>
		verbatim.add(match[1]?.trim() || `${match[2].trim()}code`),
	);
	// \newenvironment{code}{\verbatim}{\endverbatim}
	named(
		/\\(?:re)?newenvironment\s*\{([^}]+)\}\s*(?:\[[^\]]*\]\s*)*\{[^{}]*\\(?:verbatim|Verbatim|lstlisting|minted|comment)\b/g,
		(match) => verbatim.add(match[1].trim()),
	);
	named(/\\(?:MakeShortVerb|DefineShortVerb)\*?\s*\{?\\(.)/g, (match) =>
		shortVerb.add(match[1]),
	);
	named(/\\lstMakeShortInline\s*(?:\[[^\]]*\])?\s*\{?\\?([^\s{}])/g, (match) =>
		shortVerb.add(match[1]),
	);
	named(
		/\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|(?:New|Renew|Provide|Declare)DocumentCommand)\*?\s*\{?\s*\\([a-zA-Z@]+)/g,
		(match) => defined.add(`\\${match[1]}`),
	);
	named(/\\(?:[gex]?def|let)\s*\\([a-zA-Z@]+)/g, (match) =>
		defined.add(`\\${match[1]}`),
	);
	return { verbatim, shortVerb, defined };
};

/**
 * The structural mistakes of a LaTeX file, in the order of the text.
 * `mathOnly` lists the commands of math mode, such as \alpha.
 */
export function checkLatexCode(
	text: string,
	mathOnly: ReadonlySet<string> = new Set(),
): CodeProblem[] {
	const problems: CodeProblem[] = [];
	const stack: Opener[] = [];
	let documentClass: { from: number; to: number } | null = null;
	let hasDocument = false;
	const own = declarations(text);
	const isVerbatim = (name: string) =>
		VERBATIM_ENVIRONMENTS.has(name) || own.verbatim.has(name);

	const report = (
		from: number,
		to: number,
		kind: CodeProblemKind,
		command: string,
		extra: Partial<CodeProblem> = {},
	) => {
		if (problems.length >= MAX_PROBLEMS) return;
		const severity =
			kind === 'missing' || (kind === 'mathOnly' && !command.startsWith('\\'))
				? 'warning'
				: 'error';
		problems.push({ from, to, severity, kind, command, ...extra });
	};
	const reportUnclosed = (open: Opener) =>
		report(open.from, open.to, 'unclosed', open.command);

	const top = () => stack[stack.length - 1];
	const mode = (): Mode => top()?.mode ?? 'text';
	const lenient = () => top()?.lenient ?? false;
	const push = (
		type: Opener['type'],
		from: number,
		to: number,
		command: string,
		inner: Mode = mode(),
		name?: string,
	) =>
		stack.push({
			type,
			from,
			to,
			command,
			name,
			mode: inner,
			lenient:
				lenient() || (name !== undefined && LENIENT_ENVIRONMENTS.has(name)),
		});
	// The innermost opener matching, not looking past a barrier.
	const find = (
		matches: (open: Opener) => boolean,
		barrier: (open: Opener) => boolean,
	) => {
		for (let index = stack.length - 1; index >= 0; index--) {
			if (matches(stack[index])) return index;
			if (barrier(stack[index])) return -1;
		}
		return -1;
	};
	// Closes the opener at `index`; those opened inside it never were.
	const closeAt = (index: number) => {
		for (const open of stack.splice(index).slice(1)) reportUnclosed(open);
	};
	// Math delimiters close over groups and \left only.
	const insideMath = (open: Opener) =>
		open.type !== 'group' && open.type !== 'left';

	// The command whose arguments the next group would be.
	let argumentOf: string | null = null;
	// In math, the argument of a macro unknown here may be text, as in
	// \autorightleftharpoons{$k_a$}{$k_b$}: math opens again inside it.
	const opensMath = () => {
		if (mode() === 'text') return true;
		const open = top();
		return (
			open?.type === 'group' &&
			!!open.argumentOf &&
			!mathOnly.has(`\\${open.argumentOf}`)
		);
	};
	const openMath = (from: number, to: number, command: string) => {
		if (opensMath()) push('math', from, to, command, 'math');
		else report(from, to, 'notAllowedInMath', command);
	};
	const closeMath = (from: number, to: number, opening: string) => {
		const index = find(
			(open) => open.type === 'math' && open.command === opening,
			insideMath,
		);
		if (index === -1) report(from, to, 'closesNothing', text.slice(from, to));
		else closeAt(index);
	};

	const dollar = (from: number) => {
		const double = text[from + 1] === '$';
		if (opensMath()) {
			const command = double ? '$$' : '$';
			push('math', from, from + command.length, command, 'math');
			return from + command.length;
		}
		const index = find(
			(open) =>
				open.type === 'math' && (open.command === '$' || open.command === '$$'),
			insideMath,
		);
		if (index !== -1 && stack[index].command === '$') {
			closeAt(index);
			return from + 1;
		}
		if (index !== -1 && double) {
			closeAt(index);
			return from + 2;
		}
		const command = double && index === -1 ? '$$' : '$';
		report(from, from + command.length, 'notAllowedInMath', command);
		return from + command.length;
	};

	// A blank line ends inline and display math delimiters, and is an error
	// in math environments.
	const paragraphBreak = () => {
		if (mode() !== 'math') return;
		for (let index = stack.length - 1; index >= 0; index--) {
			const open = stack[index];
			if (open.type === 'math') {
				report(open.from, open.to, 'paragraphEnd', open.command);
				stack.splice(index);
				return;
			}
			if (open.type === 'env' && MATH_ENVIRONMENTS.has(open.name ?? '')) {
				if (!open.blankLineReported) {
					open.blankLineReported = true;
					report(open.from, open.to, 'blankLineInMath', open.command);
				}
				return;
			}
			if (open.mode !== 'math') return;
		}
	};

	const environmentName = (pos: number) => {
		const open = skipSpaces(text, pos);
		if (text[open] !== '{') return null;
		const close = text.indexOf('}', open);
		if (close === -1 || text.slice(open, close).includes('\n')) return null;
		return { name: text.slice(open + 1, close).trim(), end: close + 1 };
	};

	const begin = (from: number, pos: number) => {
		const env = environmentName(pos);
		if (!env) return pos;
		const command = text.slice(from, env.end);
		if (env.name === 'document') hasDocument = true;
		if (isVerbatim(env.name)) {
			const end = new RegExp(
				`\\\\end\\s*\\{${env.name.replace(/[*]/g, '\\*')}\\}`,
				'g',
			);
			end.lastIndex = env.end;
			const match = end.exec(text);
			if (!match) {
				report(from, env.end, 'unclosed', command);
				return text.length;
			}
			return match.index + match[0].length;
		}
		if (mode() === 'math' && DISPLAY_MATH_ENVIRONMENTS.has(env.name)) {
			report(from, env.end, 'notAllowedInMath', command);
		}
		const inner: Mode = MATH_ENVIRONMENTS.has(env.name)
			? 'math'
			: TEXT_ENVIRONMENTS.has(env.name)
				? 'text'
				: mode();
		push('env', from, env.end, command, inner, env.name);
		const columns = TABLE_ARGUMENTS[env.name];
		return columns ? skipArguments(text, env.end, columns) : env.end;
	};

	const end = (from: number, pos: number) => {
		const env = environmentName(pos);
		if (!env) return pos;
		const command = text.slice(from, env.end);
		const index = find(
			(open) => open.type === 'env' && open.name === env.name,
			() => false,
		);
		if (index !== -1) {
			closeAt(index);
		} else {
			// A misspelt or wrong \end closes the environment it ends.
			const nearest = find(
				(open) => open.type === 'env',
				() => false,
			);
			if (nearest !== -1 && stack[nearest].name !== 'document') {
				report(from, env.end, 'closedBy', stack[nearest].command, {
					closing: command,
				});
				closeAt(nearest);
			} else {
				report(from, env.end, 'closesNothing', command);
			}
		}
		// TeX reads nothing after \end{document}.
		return env.name === 'document' && index !== -1 ? text.length : env.end;
	};

	const command = (from: number, name: string, pos: number): number => {
		// \protect\end{x} and the like are written, not run, here.
		const written =
			argumentOf !== null &&
			['protect', 'string', 'noexpand', 'unexpanded'].includes(argumentOf);
		switch (name) {
			case 'begin':
			case 'end': {
				if (written) return environmentName(pos)?.end ?? pos;
				return name === 'begin' ? begin(from, pos) : end(from, pos);
			}
			case 'ExplSyntaxOn': {
				// expl3 code: _ and : are letters there.
				const off = text.indexOf('\\ExplSyntaxOff', pos);
				return off === -1 ? text.length : off;
			}
			case 'iffalse': {
				const fi = /\\fi(?![a-zA-Z@])/g;
				fi.lastIndex = pos;
				const match = fi.exec(text);
				return match ? match.index + match[0].length : text.length;
			}
			case 'verb':
			case 'lstinline':
			case 'mintinline':
				return skipInlineVerbatim(text, pos, name);
			case 'left':
				if (mode() === 'math') push('left', from, pos, '\\left', 'math');
				break;
			case 'right':
				if (mode() === 'math') {
					const index = find((open) => open.type === 'left', insideMath);
					if (index === -1) report(from, pos, 'closesNothing', '\\right');
					else closeAt(index);
				}
				break;
			case 'let': {
				// \let\a\b, \let\a=\b: neither name is used here.
				let next = skipSpaces(text, skipName(text, pos));
				if (text[next] === '=') next = skipSpaces(text, next + 1);
				return skipName(text, next);
			}
		}
		if (name === 'documentclass') documentClass = { from, to: pos };
		if (RAW_ARGUMENTS.has(name)) {
			const open = skipArgumentSpace(text, pos);
			if (text[open] !== '{') return pos;
			const close = groupEnd(text, open, true);
			return close === -1 ? pos : close;
		}
		if (DEFINITIONS.has(name)) return skipDefinition(text, pos);
		if (TEX_DEFINITIONS.has(name)) return skipTexDefinition(text, pos);
		const control = `\\${name}`;
		if (
			Object.hasOwn(NAME_ARGUMENTS, name) ||
			/cite/i.test(name) ||
			// Settings: \tcbset{...}, \setupenigma{...}{key_name = ...}
			(/^setup|(?:setup|set|keys|options)$/i.test(name) &&
				!mathOnly.has(control))
		) {
			return skipArguments(text, pos, NAME_ARGUMENTS[name] ?? 1);
		}
		if (
			mode() === 'text' &&
			!lenient() &&
			mathOnly.has(control) &&
			!NOT_MATH_ONLY.has(control) &&
			!own.defined.has(control)
		) {
			report(from, pos, 'mathOnly', control);
		}
		// \text{...} in math, \ensuremath{...} in text: the mode of the group.
		const switches =
			mode() === 'math' ? TEXT_COMMANDS.has(name) : name === 'ensuremath';
		if (switches) {
			const open = skipArgumentSpace(text, skipOptions(text, pos));
			if (text[open] === '{') {
				push('group', open, open + 1, '{', mode() === 'math' ? 'text' : 'math');
				top().argumentOf = name;
				return open + 1;
			}
		}
		return pos;
	};

	// \logo{elte_logo}, \handout{Richard_Simon.tex}: in the argument of a
	// command, a name of a file, a key or a label.
	const inIdentifier = (pos: number) => {
		const open = top();
		if (open?.type !== 'group' || !open.argumentOf) return false;
		const close = text.indexOf('}', pos);
		if (close === -1 || close > lineEnd(text, pos)) return false;
		return /^[\w./:=,+-]+$/.test(text.slice(open.to, close));
	};

	let i = 0;
	while (i < text.length) {
		const char = text[i];
		// Only spaces and groups may stand between a command and its arguments.
		if (!/[\s{}\\]/.test(char)) argumentOf = null;
		if (char === '%') {
			i = lineEnd(text, i);
		} else if (own.shortVerb.has(char)) {
			// |...| after \MakeShortVerb{\|}
			const close = text.indexOf(char, i + 1);
			const end = lineEnd(text, i);
			i = close === -1 || close > end ? end : close + 1;
		} else if (char === '\\') {
			const from = i;
			if (isLetter(text[i + 1])) {
				let j = i + 1;
				while (isLetter(text[j])) j++;
				const name = text.slice(from + 1, j);
				i = command(from, name, j);
				argumentOf = i === j ? name : null;
				continue;
			}
			// A control symbol: \\, \$, \{, \%, \(, \[ ...
			const symbol = text[i + 1];
			argumentOf = null;
			i += 2;
			if (symbol === '(') openMath(from, i, '\\(');
			else if (symbol === '[') openMath(from, i, '\\[');
			else if (symbol === ')') closeMath(from, i, '\\(');
			else if (symbol === ']') closeMath(from, i, '\\[');
		} else if (char === '{') {
			// Every argument of \parbox, \makebox... is text, even in math.
			const inner: Mode =
				argumentOf === 'ensuremath'
					? 'math'
					: argumentOf !== null && TEXT_COMMANDS.has(argumentOf)
						? 'text'
						: mode();
			push('group', i, i + 1, '{', inner);
			top().argumentOf = argumentOf;
			argumentOf = null;
			i++;
		} else if (char === '}') {
			const index = find(
				(open) => open.type === 'group',
				(open) => open.type === 'env',
			);
			if (index === -1) {
				report(i, i + 1, 'closesNothing', '}');
			} else {
				// The next group may be its next argument.
				argumentOf = stack[index].argumentOf ?? null;
				closeAt(index);
			}
			i++;
		} else if (char === '$') {
			i = dollar(i);
		} else if (char === '^' && text[i + 1] === '^') {
			// TeX's ^^e9: a character by its code.
			i += /^[0-9a-f]{2}$/.test(text.slice(i + 2, i + 4)) ? 4 : 3;
		} else if (char === '^' || char === '_') {
			if (mode() === 'text' && !lenient() && !inIdentifier(i)) {
				report(i, i + 1, 'mathOnly', char);
			}
			i++;
		} else if (char === '\n') {
			const next = skipSpaces(text, i + 1);
			if (text[next] === '\n') {
				paragraphBreak();
				i = next;
			} else {
				i++;
			}
		} else {
			i++;
		}
	}
	for (const open of stack) reportUnclosed(open);
	if (documentClass && !hasDocument) {
		const { from, to } = documentClass;
		report(from, to, 'missing', '\\begin{document}');
	}
	return problems.sort((a, b) => a.from - b.from);
}
