// src/utils/spellingUtils.ts
import type { SpellingLanguage } from '../types/spelling';

export interface SpellingWord {
	from: number;
	to: number;
	word: string;
}

// The parts of a LaTeX syntax node the spell checker looks at; a lezer
// SyntaxNode has them all.
export interface SpellingNode {
	readonly name: string;
	readonly from: number;
	readonly to: number;
	readonly parent: SpellingNode | null;
	readonly prevSibling: SpellingNode | null;
}

// Commands and environments whose arguments or content are not prose:
// names, keys, paths, code, people.
const NOT_PROSE_NODES = new Set([
	'Comment',
	'DocumentClass',
	'UsePackage',
	'BibliographyCommand',
	'BibliographyStyleCommand',
	'Label',
	'Ref',
	'Cite',
	'Input',
	'Include',
	'Subfile',
	'IncludeGraphics',
	'IncludeSvg',
	'UrlArgument',
	'UrlCommand',
	'VerbCommand',
	'LstInlineCommand',
	'NewCommand',
	'RenewCommand',
	'NewEnvironment',
	'RenewEnvironment',
	'Def',
	'Let',
	'TheoremStyleCommand',
	'SetLengthCommand',
	'Author',
	'Affil',
	'Affiliation',
	'TextTeletypeCommand',
	'EnvNameGroup',
	'ColumnArgument',
	'SpanArgument',
	'VerbatimEnvironment',
	'TikzPictureEnvironment',
]);

const MATH_NODES = new Set([
	'DollarMath',
	'BracketMath',
	'ParenMath',
	'InlineMath',
	'DisplayMath',
	'Math',
	'EquationEnvironment',
	'EquationArrayEnvironment',
]);

// Commands whose optional argument is text, like a short section title.
const TEXT_OPTIONAL_ARGUMENTS = new Set([
	'SectioningCommand',
	'Item',
	'Caption',
]);

// Commands whose first argument names something, like a colour.
const NAMING_FIRST_ARGUMENTS = new Set([
	'TextColorCommand',
	'ColorBoxCommand',
	'NewTheoremCommand',
]);

// Commands and environments the parser does not know: their arguments are
// prose only when they hold several words, unlike {empty} or {2}.
const UNKNOWN_ARGUMENTS = new Set(['UnknownCommand', 'BeginEnv']);

// Whether the text node `node` is prose, to be spell checked, rather than
// math, a label, a path or another argument that is not meant to be read.
export function isProse(
	node: SpellingNode,
	sliceDoc: (from: number, to: number) => string,
): boolean {
	let inMathText = false;
	let child = node;
	for (
		let parent = node.parent;
		parent;
		child = parent, parent = parent.parent
	) {
		const { name } = parent;
		if (name === 'MathTextCommand') {
			inMathText = true;
		} else if (MATH_NODES.has(name)) {
			if (!inMathText) return false;
		} else if (NOT_PROSE_NODES.has(name)) {
			return false;
		} else if (name === 'OptionalArgument') {
			if (!TEXT_OPTIONAL_ARGUMENTS.has(parent.parent?.name ?? '')) return false;
		} else if (NAMING_FIRST_ARGUMENTS.has(name)) {
			if (child.prevSibling?.name.endsWith('CtrlSeq')) return false;
		} else if (UNKNOWN_ARGUMENTS.has(name)) {
			const argument = sliceDoc(child.from + 1, child.to - 1).trim();
			if (!/\s/.test(argument) || argument.includes('=')) return false;
		}
	}
	return true;
}

// Typst: what is not prose, and is not looked into. Code (raw), formulas,
// strings (paths, keys), labels, references, links, comments and imports.
const TYPST_NOT_PROSE = new Set([
	'Raw',
	'Equation',
	'Math',
	'Str',
	'Label',
	'Ref',
	'Link',
	'LineComment',
	'BlockComment',
	'ModuleImport',
	'ModuleInclude',
	'Escape',
]);
// The pieces of Typst prose. A smart quote splits a word's text, as in
// aujourd'hui, so the pieces that touch make one run.
const TYPST_PROSE_PIECES = new Set(['Text', 'SmartQuote', 'Space']);

interface TypstTree {
	iterate(spec: {
		from?: number;
		to?: number;
		enter(node: {
			name: string;
			from: number;
			to: number;
		}): boolean | undefined;
	}): void;
}

/** The runs of prose of a Typst syntax tree between `from` and `to`. */
export function typstProseRuns(
	tree: TypstTree,
	from: number,
	to: number,
): Array<{ from: number; to: number }> {
	const runs: Array<{ from: number; to: number }> = [];
	tree.iterate({
		from,
		to,
		enter(node) {
			if (TYPST_NOT_PROSE.has(node.name)) return false;
			if (!TYPST_PROSE_PIECES.has(node.name)) return undefined;
			const last = runs[runs.length - 1];
			if (last && last.to === node.from) last.to = node.to;
			else runs.push({ from: node.from, to: node.to });
			return false;
		},
	});
	return runs;
}

// Letters, with the apostrophes, hyphens and middle dots inside words:
// « aujourd'hui », « c'est-à-dire », « chercheur·e·s ».
const WORD = /[\p{L}\p{M}]+(?:['’·-][\p{L}\p{M}]+)*/gu;
// Pieces of text that look like code, addresses, paths or measures.
const NOT_PROSE_CHUNK = /[\d@/\\_=<>|#%&*+^]|:\S|\.\p{L}/u;
// A word split by an accent or letter command, like caf\'e or c\oe ur.
const ACCENT_BEFORE =
	/\\(?:['`^"~=.]|[cvuHkrbdt][ {]|(?:oe|OE|ae|AE|aa|AA|ss|[oOlLij]) ?)\{?$/;
const ACCENT_AFTER =
	/^\{?\\(?:['`^"~=.]|[cvuHkrbdt](?![A-Za-z])|(?:oe|OE|ae|AE|aa|AA|ss|[oOlLij])(?![A-Za-z]))/;

// Acronyms and names like LaTeX are left alone.
const hasInnerCapital = (word: string) =>
	word.split(/['’·-]/).some((part) => /\p{Lu}/u.test(part.slice(1)));

// The words of a run of prose starting at `offset`; `before` and `after` are
// the few characters around it in the document.
export function proseWords(
	text: string,
	offset: number,
	before = '',
	after = '',
): SpellingWord[] {
	const words: SpellingWord[] = [];
	for (const chunk of text.matchAll(/\S+/g)) {
		if (NOT_PROSE_CHUNK.test(chunk[0])) continue;
		for (const match of chunk[0].matchAll(WORD)) {
			const word = match[0];
			const start = (chunk.index ?? 0) + (match.index ?? 0);
			const end = start + word.length;
			if ([...word].length < 2 || hasInnerCapital(word)) continue;
			if (start === 0 && ACCENT_BEFORE.test(before)) continue;
			if (end === text.length && ACCENT_AFTER.test(after)) continue;
			words.push({ from: offset + start, to: offset + end, word });
		}
	}
	return words;
}

// Language names as babel and polyglossia know them.
const LANGUAGE_NAMES: Record<string, SpellingLanguage> = {
	french: 'fr',
	francais: 'fr',
	frenchb: 'fr',
	acadian: 'fr',
	canadien: 'fr',
	english: 'en-US',
	american: 'en-US',
	usenglish: 'en-US',
	canadian: 'en-US',
	british: 'en-GB',
	ukenglish: 'en-GB',
	australian: 'en-GB',
	newzealand: 'en-GB',
	german: 'de',
	ngerman: 'de',
	austrian: 'de',
	naustrian: 'de',
	swissgerman: 'de',
	nswissgerman: 'de',
	spanish: 'es',
	mexican: 'es',
	italian: 'it',
	brazil: 'pt-BR',
	brazilian: 'pt-BR',
	portuguese: 'pt-PT',
	portuges: 'pt-PT',
	dutch: 'nl',
	catalan: 'ca',
	polish: 'pl',
	russian: 'ru',
	swedish: 'sv',
	danish: 'da',
	romanian: 'ro',
};

// Other languages babel knows, which have no dictionary here.
const OTHER_LANGUAGES = new Set([
	'afrikaans',
	'arabic',
	'basque',
	'breton',
	'bulgarian',
	'chinese',
	'croatian',
	'czech',
	'esperanto',
	'estonian',
	'finnish',
	'galician',
	'greek',
	'hebrew',
	'hindi',
	'hungarian',
	'icelandic',
	'indonesian',
	'irish',
	'japanese',
	'korean',
	'latin',
	'latvian',
	'lithuanian',
	'magyar',
	'malay',
	'norsk',
	'norwegian',
	'nynorsk',
	'persian',
	'scottish',
	'serbian',
	'slovak',
	'slovene',
	'slovenian',
	'thai',
	'turkish',
	'ukrainian',
	'vietnamese',
	'welsh',
]);

const languageNamed = (name: string): SpellingLanguage | null | undefined => {
	const key = name.trim().toLowerCase();
	if (Object.hasOwn(LANGUAGE_NAMES, key)) return LANGUAGE_NAMES[key];
	return OTHER_LANGUAGES.has(key) ? null : undefined;
};

const base = (language: string) => language.split('-')[0];

const stripComments = (source: string) =>
	source.replace(/(^|[^\\])%.*$/gm, '$1');

// The main language a LaTeX document declares: set with polyglossia, or the
// last language given to babel and the class (unless babel's main= names
// it). Null for a language without a dictionary here, undefined when the
// document declares none.
export function declaredLanguage(
	source: string,
): SpellingLanguage | null | undefined {
	const text = stripComments(source);

	const polyglossia =
		/\\set(?:main|default)language\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(
			text,
		);
	if (polyglossia) {
		const language = languageNamed(polyglossia[2]);
		const variant = /variant\s*=\s*(\w+)/.exec(polyglossia[1] ?? '')?.[1];
		// A variant of the same language: British English, Brazilian
		// Portuguese.
		const byVariant = variant ? languageNamed(variant) : undefined;
		if (language && byVariant && base(byVariant) === base(language)) {
			return byVariant;
		}
		return language;
	}

	const classOptions = /\\documentclass\s*\[([^\]]*)\]/.exec(text)?.[1];
	const babelOptions =
		/\\usepackage\s*\[([^\]]*)\]\s*\{[^}]*\bbabel\b[^}]*\}/.exec(text)?.[1];
	const options = [classOptions, babelOptions]
		.filter((list): list is string => list !== undefined)
		.flatMap((list) => list.split(','))
		.map((option) => option.trim());

	const main = options.find((option) => /^main\s*=/.test(option));
	if (main) return languageNamed(main.replace(/^main\s*=/, ''));

	for (let i = options.length - 1; i >= 0; i--) {
		const language = languageNamed(options[i]);
		if (language !== undefined) return language;
	}
	return undefined;
}

// Typst's language codes (ISO 639-1) with a dictionary here, besides
// English and Portuguese, which also look at the region.
const TYPST_LANGUAGES: Record<string, SpellingLanguage> = {
	fr: 'fr',
	de: 'de',
	es: 'es',
	it: 'it',
	nl: 'nl',
	ca: 'ca',
	pl: 'pl',
	ru: 'ru',
	sv: 'sv',
	da: 'da',
	ro: 'ro',
};

// Regions whose English is British.
const BRITISH_REGIONS = new Set(['gb', 'uk', 'au', 'nz', 'ie', 'za', 'in']);

/**
 * The language a Typst document sets for its text, as #set text(lang: "fr")
 * or #set text(lang: "en", region: "GB"): the first such rule. Null for a
 * language without a dictionary here, undefined when it sets none.
 */
export function declaredTypstLanguage(
	source: string,
): SpellingLanguage | null | undefined {
	const text = source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:\\])\/\/.*$/gm, '$1');
	for (const match of text.matchAll(/#set\s+text\s*\(/g)) {
		const start = (match.index ?? 0) + match[0].length;
		let depth = 1;
		let end = start;
		for (; end < text.length && depth > 0; end++) {
			if (text[end] === '(') depth++;
			else if (text[end] === ')') depth--;
		}
		const args = text.slice(start, end);
		const lang = /\blang\s*:\s*"([^"]*)"/.exec(args)?.[1]?.toLowerCase();
		if (!lang) continue;
		const region = /\bregion\s*:\s*"([^"]*)"/.exec(args)?.[1]?.toLowerCase();
		if (lang === 'en') {
			return region && BRITISH_REGIONS.has(region) ? 'en-GB' : 'en-US';
		}
		// Portuguese is Brazil's unless the region says Portugal.
		if (lang === 'pt') return region === 'pt' ? 'pt-PT' : 'pt-BR';
		return Object.hasOwn(TYPST_LANGUAGES, lang) ? TYPST_LANGUAGES[lang] : null;
	}
	return undefined;
}

// The most common short words of each language, chosen apart from those of
// its neighbours (Spanish and Portuguese, Swedish and Danish...), so that a
// few lines tell them apart.
const COMMON_WORDS: Array<[SpellingLanguage, ReadonlySet<string>]> = (
	[
		[
			'fr',
			'au aux avec ce cette dans des du est et il le les leur mais nous où par pas pour qui sont sur une',
		],
		[
			'en-US',
			'an and are be by can for from have in is it not of that the this to was we which with',
		],
		[
			'de',
			'der die das und ist nicht mit den dem sich auf für ein eine auch werden wird von zu im sind bei oder wir nach',
		],
		[
			'es',
			'el los las del y más pero sus también cuando muy hay sino está están según',
		],
		[
			'pt-BR',
			'os da do das dos em não ao é na foi são pelo pela isso essa também um uma',
		],
		[
			'it',
			'di che della delle degli nel nella sono non gli anche come più alla dei questo questa essere è il per una con',
		],
		[
			'nl',
			'het een van dat op zijn met voor niet aan ook als bij door wordt worden deze naar maar wel',
		],
		[
			'ca',
			'els amb dels aquest aquesta però és són més també seva seu pel per i',
		],
		[
			'pl',
			'się nie że jest przez dla są ale oraz który która które jak tego jego w z',
		],
		[
			'ru',
			'и в не на что с по как это для из к от у же но так его она он они мы при был были',
		],
		[
			'sv',
			'och att är av för inte ett också mycket vara kommer dessa denna detta till från ska mellan där hur när deras våra bara några varje',
		],
		[
			'da',
			'og at er af ikke et også meget være kommer disse denne dette til fra skal mellem hvor hvis når deres vores kun nogle hver',
		],
		[
			'ro',
			'și în cu pe care nu din este sunt pentru mai sau ale prin această acest fost',
		],
	] as Array<[SpellingLanguage, string]>
).map(([language, words]) => [language, new Set(words.split(' '))]);

// The language `text` is written in, from its most common words, when it
// clearly is one of those with a dictionary here (Portuguese as Brazil's,
// English as the United States'): at least 8 of them, twice as many as of
// any other language.
export function guessLanguage(text: string): SpellingLanguage | undefined {
	const counts = new Map<SpellingLanguage, number>();
	for (const [word] of text.toLowerCase().matchAll(/\p{L}+/gu)) {
		for (const [language, words] of COMMON_WORDS) {
			if (words.has(word))
				counts.set(language, (counts.get(language) ?? 0) + 1);
		}
	}
	const [best, second] = [...counts].sort((a, b) => b[1] - a[1]);
	if (!best || best[1] < 8) return undefined;
	return !second || best[1] >= 2 * second[1] ? best[0] : undefined;
}

// The dictionary that goes with the interface language.
export function interfaceSpellingLanguage(language: string): SpellingLanguage {
	const code = language.toLowerCase();
	if (code.startsWith('fr')) return 'fr';
	if (code === 'en-gb') return 'en-GB';
	if (code.startsWith('de')) return 'de';
	if (code.startsWith('it')) return 'it';
	return 'en-US';
}

// LanguageTool's code for each language (server/collab/grammar.js), with the
// country its rules need.
const GRAMMAR_LANGUAGES: Record<SpellingLanguage, string> = {
	fr: 'fr',
	'en-US': 'en-US',
	'en-GB': 'en-GB',
	de: 'de-DE',
	es: 'es',
	it: 'it',
	'pt-BR': 'pt-BR',
	'pt-PT': 'pt-PT',
	nl: 'nl',
	ca: 'ca-ES',
	pl: 'pl-PL',
	ru: 'ru-RU',
	sv: 'sv',
	da: 'da-DK',
	ro: 'ro-RO',
};

export const grammarLanguageOf = (language: SpellingLanguage): string =>
	GRAMMAR_LANGUAGES[language];
