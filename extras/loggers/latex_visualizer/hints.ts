// extras/loggers/latex_visualizer/hints.ts
// What the most common LaTeX errors and warnings mean and how to fix them,
// as Overleaf explains them under each entry of its logs.
//
// Code in the explanations goes in as parameters: braces in a translation
// key would be read as placeholders.
import { t } from '@/i18n';

export interface HintSource {
	type: 'error' | 'warning' | 'info';
	message: string;
	lineContent?: string;
}

type Rule = {
	pattern: RegExp;
	type?: HintSource['type'];
	hint: (match: RegExpMatchArray, entry: HintSource) => string;
};

// Packages that define environments people often use without loading them.
const ENVIRONMENT_PACKAGES: Record<string, string> = {
	align: 'amsmath',
	'align*': 'amsmath',
	alignat: 'amsmath',
	'alignat*': 'amsmath',
	gather: 'amsmath',
	'gather*': 'amsmath',
	multline: 'amsmath',
	'multline*': 'amsmath',
	split: 'amsmath',
	flalign: 'amsmath',
	'flalign*': 'amsmath',
	pmatrix: 'amsmath',
	bmatrix: 'amsmath',
	vmatrix: 'amsmath',
	cases: 'amsmath',
	proof: 'amsthm',
	tikzpicture: 'tikz',
	lstlisting: 'listings',
	minted: 'minted',
	algorithmic: 'algpseudocode',
	algorithm: 'algorithm',
	subfigure: 'subcaption',
	longtable: 'longtable',
	tabularx: 'tabularx',
	multicols: 'multicol',
	landscape: 'pdflscape',
	comment: 'comment',
	wrapfigure: 'wrapfig',
	frame: 'beamer (documentclass)',
};

// The command TeX stopped at: the last one of the context line it shows.
const lastCommand = (lineContent?: string) =>
	/(\\(?:[A-Za-z@]+|.))\s*$/.exec(lineContent?.trim() ?? '')?.[1];

const packageLine = (name: string) => `\\usepackage{${name}}`;

const RULES: Rule[] = [
	{
		pattern: /^Undefined control sequence/,
		hint: (_match, entry) => {
			const command = lastCommand(entry.lineContent);
			return command
				? t(
						'TeX does not know the command {command}. Check its spelling; if it comes from a package, load it in the preamble with {usepackage}; if it is your own, define it with {newcommand} before using it.',
						{
							command,
							usepackage: packageLine('…'),
							newcommand: '\\newcommand',
						},
					)
				: t(
						'TeX does not know a command on this line. Check its spelling; if it comes from a package, load it in the preamble with {usepackage}; if it is your own, define it with {newcommand} before using it.',
						{ usepackage: packageLine('…'), newcommand: '\\newcommand' },
					);
		},
	},
	{
		pattern: /^Missing \$ inserted/,
		hint: () =>
			t(
				'A character or command that only works in math, such as {examples}, is outside math mode, or a formula is not closed. Put the formula between {inline} or {display}; in text, write {underscore} for an underscore. A blank line inside an equation also causes this error.',
				{
					examples: '_ ^ \\alpha \\sum',
					inline: '$…$',
					display: '\\[…\\]',
					underscore: '\\_',
				},
			),
	},
	{
		pattern: /^Extra \}, or forgotten \$/,
		hint: () =>
			t(
				'A closing brace {close} has no opening brace to match it, or a {dollar} is missing. Count the braces on this line.',
				{ close: '}', dollar: '$' },
			),
	},
	{
		pattern: /^Missing \} inserted/,
		hint: () =>
			t(
				'A closing brace {close} is missing: a group opened with {open} is not closed, often in a formula.',
				{ close: '}', open: '{' },
			),
	},
	{
		pattern: /^Missing \{ inserted/,
		hint: () =>
			t(
				'An opening brace {open} is missing, often after a command that takes an argument, such as {examples}.',
				{ open: '{', examples: '\\frac, ^ _' },
			),
	},
	{
		pattern: /^Too many \}'s/,
		hint: () =>
			t(
				'There are more closing braces {close} than opening ones. Remove the extra one, or add the opening brace that is missing.',
				{ close: '}' },
			),
	},
	{
		pattern: /^Environment (\S+?) undefined/,
		hint: (match) => {
			const name = match[1];
			const known = ENVIRONMENT_PACKAGES[name];
			return known
				? t(
						'The environment {name} is not defined: it comes from the package {package}. Add {usepackage} to the preamble.',
						{
							name,
							package: known,
							usepackage: known.includes(' ') ? known : packageLine(known),
						},
					)
				: t(
						'The environment {name} is not defined. Check its spelling, or load the package that defines it in the preamble.',
						{ name },
					);
		},
	},
	{
		pattern:
			/^\\begin\{([^}]+)\} on input line (\d+) ended by \\end\{([^}]+)\}/,
		hint: (match) =>
			t(
				'The environment {open}, opened on line {line}, is closed by {close}. Close environments in the reverse order of opening them, and check the spelling of both names.',
				{
					open: match[1],
					line: match[2],
					close: `\\end{${match[3]}}`,
				},
			),
	},
	{
		pattern: /^\\begin\{([^}]+)\} ended by \\end\{([^}]+)\}/,
		hint: (match) =>
			t(
				'The environment {open} is closed by {close}. Close environments in the reverse order of opening them; an environment that is not defined, reported above, also causes this.',
				{ open: match[1], close: `\\end{${match[2]}}` },
			),
	},
	{
		pattern: /^File `([^']+)' not found/,
		hint: (match) =>
			match[1].endsWith('.sty') || match[1].endsWith('.cls')
				? t(
						'The package or class {name} is not installed in TeX Live, or its name is misspelled.',
						{ name: match[1].replace(/\.(sty|cls)$/, '') },
					)
				: t(
						'The file {file} cannot be found. Check its name, capitals included, and its path from the main document, and that it is part of the project.',
						{ file: match[1] },
					),
	},
	{
		pattern: /^I can't find file `?([^'`]+)/,
		hint: (match) =>
			t(
				'The file {file} cannot be found. Check its name, capitals included, and its path from the main document, and that it is part of the project.',
				{ file: match[1].trim() },
			),
	},
	{
		pattern: /^Missing \\begin\{document\}/,
		hint: () =>
			t(
				'Text appears before {begin}, or the document has none. The preamble may only hold commands such as {usepackage}; look for a character typed there by mistake.',
				{ begin: '\\begin{document}', usepackage: '\\usepackage' },
			),
	},
	{
		pattern: /^There's no line here to end/,
		hint: () =>
			t(
				'{newline} is used where no line is under way, for example at the start of a paragraph or after a blank line. To space paragraphs, use {vspace} or a blank line.',
				{ newline: '\\\\', vspace: '\\vspace' },
			),
	},
	{
		pattern: /^Misplaced alignment tab character &/,
		hint: () =>
			t(
				'The character {amp} only separates the columns of a table or an alignment. To print it in text, write {escaped}.',
				{ amp: '&', escaped: '\\&' },
			),
	},
	{
		pattern: /^Extra alignment tab has been changed/,
		hint: () =>
			t(
				'A row of the table has more cells, separated by {amp}, than the columns declared in {tabular}. Declare one more column, or remove an {amp}.',
				{ amp: '&', tabular: '\\begin{tabular}{…}' },
			),
	},
	{
		pattern: /^Paragraph ended before (\S+) was complete/,
		hint: (match) =>
			t(
				'The argument of {command} holds a blank line, or a closing brace is missing. A blank line ends the paragraph, which this argument does not allow.',
				{ command: match[1] },
			),
	},
	{
		pattern: /^Runaway argument/,
		hint: () =>
			t(
				'An argument does not end: a closing brace {close} is probably missing.',
				{ close: '}' },
			),
	},
	{
		pattern: /^File ended while scanning use of (\S+)/,
		hint: (match) =>
			t(
				'The file ends before the argument of {command} is closed: a closing brace {close} is missing.',
				{ command: match[1].replace(/\.$/, ''), close: '}' },
			),
	},
	{
		pattern: /^Argument of (\S+) has an extra \}/,
		hint: (match) =>
			t(
				'The argument of {command} is not closed properly: a closing brace {close} is one too many, or the command expects more arguments.',
				{ command: match[1], close: '}' },
			),
	},
	{
		pattern: /^Double (superscript|subscript)/,
		hint: (match) =>
			match[1] === 'superscript'
				? t(
						'Two superscripts follow each other, as in {wrong}. Group them with braces: {right}.',
						{ wrong: 'x^2^3', right: 'x^{2^3}' },
					)
				: t(
						'Two subscripts follow each other, as in {wrong}. Group them with braces: {right}.',
						{ wrong: 'x_i_j', right: 'x_{i_j}' },
					),
	},
	{
		pattern: /Unicode character (.+?) \(U\+([0-9A-Fa-f]+)\)/,
		hint: (match) =>
			t(
				'The character {character} (U+{code}) is not available with pdfLaTeX and the current fonts. Replace it with its LaTeX command, or compile with XeLaTeX or LuaLaTeX, chosen in the compile options.',
				{ character: match[1], code: match[2].toUpperCase() },
			),
	},
	{
		pattern: /^Can be used only in preamble/,
		hint: () =>
			t('This command, such as {usepackage}, must come before {begin}.', {
				usepackage: '\\usepackage',
				begin: '\\begin{document}',
			}),
	},
	{
		pattern: /^Option clash for package (\S+?)\.?$/,
		hint: (match) =>
			t(
				'The package {package} is loaded twice with different options, sometimes by another package. Load it once, with all its options.',
				{ package: match[1] },
			),
	},
	{
		pattern: /^Command (\S+) already defined/,
		hint: (match) =>
			t(
				'The command {command} already exists. Choose another name, or use {renewcommand} to redefine it.',
				{ command: match[1], renewcommand: '\\renewcommand' },
			),
	},
	{
		pattern: /^Lonely \\item/,
		hint: () =>
			t('{item} only works inside a list: {lists}.', {
				item: '\\item',
				lists: 'itemize, enumerate, description',
			}),
	},
	{
		pattern: /^Something's wrong--perhaps a missing \\item/,
		hint: () =>
			t(
				'A list does not start with {item}, or {newline} is used where nothing precedes it, for example in an empty list or table cell.',
				{ item: '\\item', newline: '\\\\' },
			),
	},
	{
		pattern: /^Too many unprocessed floats/,
		hint: () =>
			t(
				'Too many figures and tables are waiting to be placed. Add {clearpage} now and then, or give them more freedom with {placement}.',
				{ clearpage: '\\clearpage', placement: '[htbp]' },
			),
	},
	{
		pattern: /^Not in outer par mode/,
		hint: () =>
			t(
				'A figure or table is inside a box, a table or a minipage, where floats are not allowed. Take it out, or use {here} with the float package.',
				{ here: '[H]' },
			),
	},
	{
		pattern: /^\\include cannot be nested/,
		hint: () =>
			t(
				'A file brought in with {include} brings in another one with {include}. Use {input} for nested files.',
				{ include: '\\include', input: '\\input' },
			),
	},
	{
		pattern: /^Illegal unit of measure/,
		hint: () =>
			t('A length has no valid unit: write for example {examples}.', {
				examples: '2cm, 10pt, 0.5\\textwidth',
			}),
	},
	{
		pattern:
			/^(?:Illegal parameter number in definition|You can't use .macro parameter character #)/,
		hint: () =>
			t(
				'A {hash} in a definition points to an argument that does not exist, or {hash} is used in text: write {escaped} to print it.',
				{ hash: '#', escaped: '\\#' },
			),
	},
	{
		pattern: /^Display math should end with \$\$/,
		hint: () =>
			t('A displayed formula opened with {open} is not closed the same way.', {
				open: '$$',
			}),
	},
	{
		pattern: /^Emergency stop/,
		hint: () =>
			t(
				'Compiling stopped without making a PDF. Fix the first error of the list first: those after it often follow from it.',
			),
	},

	// Warnings
	{
		pattern: /^Citation `([^']+)'.* undefined/,
		hint: (match) =>
			t(
				'The citation {key} is not in the bibliography. Check the key in the .bib file, and that {bibliography} or {addbibresource} names that file; then compile again.',
				{
					key: match[1],
					bibliography: '\\bibliography{…}',
					addbibresource: '\\addbibresource{…}',
				},
			),
	},
	{
		pattern: /^Reference `([^']+)'.* undefined/,
		hint: (match) =>
			t(
				'The label {label} does not exist: check the spelling of {ref} and {labelCommand}. If the label was just added, compile once more.',
				{ label: match[1], ref: '\\ref', labelCommand: '\\label' },
			),
	},
	{
		pattern: /^There were undefined references/,
		hint: () =>
			t(
				'Some references ({ref}, {cite}) are not resolved yet. Compile again; if this stays, see the references named in the list.',
				{ ref: '\\ref', cite: '\\cite' },
			),
	},
	{
		pattern: /^Label `([^']+)' multiply defined/,
		hint: (match) =>
			t(
				'Two labels are named {label}, so references to it are ambiguous. Give them different names.',
				{ label: match[1] },
			),
	},
	{
		pattern: /^There were multiply-defined labels/,
		hint: () =>
			t(
				'Several labels share a name, so references to them are ambiguous. Give them different names.',
			),
	},
	{
		pattern: /^Label\(s\) may have changed/,
		hint: () =>
			t('Cross-references changed: compile again to bring them up to date.'),
	},
	{
		pattern: /^Overfull \\?hbox/,
		hint: () =>
			t(
				'A line runs into the margin, often because of a word LaTeX cannot hyphenate, a URL or an image too wide. Rephrase, add a hyphenation point with {hyphen}, or shrink the image ({width}).',
				{ hyphen: '\\-', width: 'width=\\linewidth' },
			),
	},
	{
		pattern: /^Underfull \\?hbox/,
		hint: () =>
			t(
				'A line has too much space, often because of {newline} at the end of a paragraph or after a blank line. The PDF is fine; remove the extra {newline}.',
				{ newline: '\\\\' },
			),
	},
	{
		pattern: /^(?:Over|Under)full \\?vbox/,
		hint: () =>
			t(
				'A page holds more or less than its height allows, often because of a figure too tall or a forced page break.',
			),
	},
	{
		pattern: /^Float too large for page/,
		hint: () =>
			t(
				'A figure or table is taller than the page. Make it smaller, for example with {height}.',
				{ height: 'height=0.8\\textheight,keepaspectratio' },
			),
	},
	{
		pattern: /float specifier changed to/,
		hint: () =>
			t(
				'LaTeX could not place the figure or table exactly here and moved it. Use {placement} to give it more choice.',
				{ placement: '[htbp]' },
			),
	},
	{
		pattern: /^Missing character/,
		hint: () =>
			t(
				'The current font lacks this character, so it does not show in the PDF. With XeLaTeX or LuaLaTeX, choose a font that has it ({fontspec}).',
				{ fontspec: 'fontspec' },
			),
	},
	{
		pattern: /^Font shape `[^']+' undefined/,
		hint: () =>
			t(
				'This variant of the font (bold, italic…) does not exist; LaTeX used a close one instead.',
			),
	},
	{
		pattern: /^No \\author given/,
		hint: () =>
			t('{maketitle} has no author: add {author} to the preamble.', {
				maketitle: '\\maketitle',
				author: '\\author{…}',
			}),
	},
	{
		pattern:
			/(?:Empty bibliography|Please \(?re\)?run Biber|Please rerun LaTeX)/,
		hint: () =>
			t(
				'The bibliography is not ready: no source is cited yet, or the bibliography has not been processed. Compile again.',
			),
	},
];

/** The explanation of a log entry, or undefined for those it lacks. */
export function latexHint(entry: HintSource): string | undefined {
	// "LaTeX Error:" or "Package x Error:" in front tells nothing more.
	const message = entry.message
		.replace(/^(?:LaTeX|Package \S+) Error:\s*/, '')
		.replace(/^\S+: /, (prefix) =>
			// Package warnings start with the package's name.
			entry.type === 'warning' ? '' : prefix,
		)
		.trim();
	for (const rule of RULES) {
		if (rule.type && rule.type !== entry.type) continue;
		const match =
			message.match(rule.pattern) ?? entry.message.match(rule.pattern);
		if (match) return rule.hint(match, entry);
	}
	return undefined;
}
