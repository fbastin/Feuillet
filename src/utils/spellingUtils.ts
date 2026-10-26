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
};

// Other languages babel knows, which have no dictionary here.
const OTHER_LANGUAGES = new Set([
	'afrikaans',
	'arabic',
	'austrian',
	'basque',
	'brazil',
	'brazilian',
	'breton',
	'bulgarian',
	'catalan',
	'chinese',
	'croatian',
	'czech',
	'danish',
	'dutch',
	'esperanto',
	'estonian',
	'finnish',
	'galician',
	'german',
	'greek',
	'hebrew',
	'hindi',
	'hungarian',
	'icelandic',
	'indonesian',
	'irish',
	'italian',
	'japanese',
	'korean',
	'latin',
	'latvian',
	'lithuanian',
	'magyar',
	'malay',
	'naustrian',
	'ngerman',
	'norsk',
	'norwegian',
	'nswissgerman',
	'nynorsk',
	'persian',
	'polish',
	'portuges',
	'portuguese',
	'romanian',
	'russian',
	'scottish',
	'serbian',
	'slovak',
	'slovene',
	'slovenian',
	'spanish',
	'swedish',
	'swissgerman',
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
		if (language === 'en-US' && variant) {
			return languageNamed(variant) ?? language;
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

const FRENCH_WORDS = new Set([
	'au',
	'aux',
	'avec',
	'ce',
	'cette',
	'dans',
	'des',
	'du',
	'en',
	'est',
	'et',
	'il',
	'la',
	'le',
	'les',
	'leur',
	'mais',
	'nous',
	'où',
	'par',
	'pas',
	'pour',
	'que',
	'qui',
	'sont',
	'sur',
	'un',
	'une',
]);

const ENGLISH_WORDS = new Set([
	'an',
	'and',
	'are',
	'be',
	'by',
	'can',
	'for',
	'from',
	'have',
	'in',
	'is',
	'it',
	'not',
	'of',
	'that',
	'the',
	'this',
	'to',
	'was',
	'we',
	'which',
	'with',
]);

// French or English, from the most common words of `text`, when it clearly
// is one of them.
export function guessLanguage(text: string): SpellingLanguage | undefined {
	let french = 0;
	let english = 0;
	for (const [word] of text.toLowerCase().matchAll(/\p{L}+/gu)) {
		if (FRENCH_WORDS.has(word)) french++;
		else if (ENGLISH_WORDS.has(word)) english++;
	}
	if (french + english < 10) return undefined;
	if (french >= 2 * english) return 'fr';
	if (english >= 2 * french) return 'en-US';
	return undefined;
}

// The dictionary that goes with the interface language.
export function interfaceSpellingLanguage(language: string): SpellingLanguage {
	const code = language.toLowerCase();
	if (code.startsWith('fr')) return 'fr';
	if (code === 'en-gb') return 'en-GB';
	return 'en-US';
}
