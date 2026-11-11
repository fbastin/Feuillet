// src/utils/latexDefinitions.ts
// The commands and environments a LaTeX document defines for itself
// (\newcommand, \DeclareMathOperator, \def, \NewDocumentCommand,
// \newenvironment, \newtheorem…), offered by the autocompletion as on
// Overleaf.

export interface LatexCommandDefinition {
	/** With its backslash: \R. */
	name: string;
	/** Arguments in braces, the optional one left out. */
	args: number;
}

export interface LatexEnvironmentDefinition {
	name: string;
	args: number;
}

export interface LatexDefinitions {
	commands: LatexCommandDefinition[];
	environments: LatexEnvironmentDefinition[];
	/**
	 * What it loads, named as TeXstudio's word lists are: packages (siunitx),
	 * classes (class-memoir), TikZ and pgfplots libraries
	 * (tikzlibraryarrows.meta), tcolorbox libraries, Beamer themes.
	 */
	packages: string[];
}

// Comments out: % not escaped, to the end of the line.
const withoutComments = (text: string): string =>
	text.replace(/(^|[^\\])((?:\\\\)*)%.*$/gm, '$1$2');

// What a {…} group starting at `from` holds, braces inside counted.
function readGroup(
	text: string,
	from: number,
): { content: string; end: number } | null {
	if (text[from] !== '{') return null;
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const char = text[i];
		if (char === '\\') {
			i++;
			continue;
		}
		if (char === '{') depth++;
		else if (char === '}' && --depth === 0) {
			return { content: text.slice(from + 1, i), end: i + 1 };
		}
	}
	return null;
}

// xparse argument specification: m is an argument in braces; o, O{…},
// s, t… are optional.
function documentCommandArgs(spec: string): number {
	let args = 0;
	for (let i = 0; i < spec.length; i++) {
		if (spec[i] === '{') i = (readGroup(spec, i)?.end ?? spec.length) - 1;
		else if (spec[i] === 'm') args++;
	}
	return args;
}

const NAME = String.raw`\\[a-zA-Z]+(?![a-zA-Z@])`;
const BRACED_OR_BARE = String.raw`(?:\{\s*(${NAME})\s*\}|(${NAME}))`;

const NEW_COMMAND = new RegExp(
	String.raw`\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand)\*?\s*${BRACED_OR_BARE}\s*(?:\[\s*(\d)\s*\])?\s*(\[)?`,
	'g',
);
const MATH_OPERATOR = new RegExp(
	String.raw`\\DeclareMathOperator\*?\s*${BRACED_OR_BARE}`,
	'g',
);
// mathtools: \DeclarePairedDelimiter{\abs}{\lvert}{\rvert} gives \abs{x}.
const PAIRED_DELIMITER = new RegExp(
	String.raw`\\DeclarePairedDelimiter(?:X|XPP)?\s*${BRACED_OR_BARE}\s*(?:\[\s*(\d)\s*\])?`,
	'g',
);
const DEF = new RegExp(
	String.raw`\\[gex]?def\s*(${NAME})((?:\s*#\d)*)\s*\{`,
	'g',
);
const LET = new RegExp(String.raw`\\let\s*(${NAME})\s*=?\s*\\`, 'g');
const DOCUMENT_COMMAND = new RegExp(
	String.raw`\\(?:New|Renew|Provide|Declare)(?:Expandable)?DocumentCommand\s*${BRACED_OR_BARE}\s*(?=\{)`,
	'g',
);

const ENV = String.raw`\{\s*([a-zA-Z0-9*]+)\s*\}`;
const NEW_ENVIRONMENT = new RegExp(
	String.raw`\\(?:(?:re)?newenvironment|NewEnviron|newtcolorbox|lstnewenvironment)\*?\s*${ENV}\s*(?:\[\s*(\d)\s*\])?`,
	'g',
);
const DOCUMENT_ENVIRONMENT = new RegExp(
	String.raw`\\(?:New|Renew|Provide|Declare)DocumentEnvironment\s*${ENV}\s*(?=\{)`,
	'g',
);
// Theorems: \newtheorem{lemme}{Lemme}, \declaretheorem[…]{lemme}.
const THEOREM = new RegExp(
	String.raw`\\(?:newtheorem\*?|declaretheorem(?:\s*\[[^\]]*\])?)\s*${ENV}`,
	'g',
);

// \usepackage[…]{a,b} and the like: the word lists of what it names.
const LOADS =
	/\\(usepackage|RequirePackage|RequirePackageWithOptions|documentclass|LoadClass|LoadClassWithOptions|usetikzlibrary|usepgfplotslibrary|tcbuselibrary|usetheme)\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/g;
const WORD_LIST_PREFIX: Record<string, string> = {
	documentclass: 'class-',
	LoadClass: 'class-',
	LoadClassWithOptions: 'class-',
	usetikzlibrary: 'tikzlibrary',
	usepgfplotslibrary: 'pgfplotslibrary',
	tcbuselibrary: 'tcolorboxlibrary',
	usetheme: 'beamertheme',
};

function findPackages(text: string): string[] {
	const packages = new Set<string>();
	for (const [, command, names] of text.matchAll(LOADS)) {
		for (const name of names.split(',')) {
			const trimmed = name.trim();
			if (/^[\w.@+-]+$/.test(trimmed))
				packages.add(`${WORD_LIST_PREFIX[command] ?? ''}${trimmed}`);
		}
	}
	return [...packages];
}

export function findLatexDefinitions(source: string): LatexDefinitions {
	const text = withoutComments(source);
	const commands = new Map<string, number>();
	const environments = new Map<string, number>();
	const command = (name: string | undefined, args: number) => {
		if (name && !commands.has(name)) commands.set(name, args);
	};
	const environment = (name: string | undefined, args: number) => {
		if (name && !environments.has(name)) environments.set(name, args);
	};

	for (const match of text.matchAll(NEW_COMMAND)) {
		const total = Number(match[3] ?? 0);
		// [n][default]: the first of the n is optional.
		command(match[1] ?? match[2], match[4] ? Math.max(0, total - 1) : total);
	}
	for (const match of text.matchAll(MATH_OPERATOR)) {
		command(match[1] ?? match[2], 0);
	}
	for (const match of text.matchAll(PAIRED_DELIMITER)) {
		command(match[1] ?? match[2], Number(match[3] ?? 1));
	}
	for (const match of text.matchAll(DEF)) {
		command(match[1], (match[2].match(/#/g) ?? []).length);
	}
	for (const match of text.matchAll(LET)) command(match[1], 0);
	for (const match of text.matchAll(DOCUMENT_COMMAND)) {
		const spec = readGroup(text, (match.index ?? 0) + match[0].length);
		command(match[1] ?? match[2], spec ? documentCommandArgs(spec.content) : 0);
	}

	for (const match of text.matchAll(NEW_ENVIRONMENT)) {
		environment(match[1], Number(match[2] ?? 0));
	}
	for (const match of text.matchAll(DOCUMENT_ENVIRONMENT)) {
		const spec = readGroup(text, (match.index ?? 0) + match[0].length);
		environment(match[1], spec ? documentCommandArgs(spec.content) : 0);
	}
	for (const match of text.matchAll(THEOREM)) environment(match[1], 0);

	return {
		commands: [...commands].map(([name, args]) => ({ name, args })),
		environments: [...environments].map(([name, args]) => ({ name, args })),
		packages: findPackages(text),
	};
}
