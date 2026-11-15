// src/utils/bibCleanup.ts
// The cleanups of a .bib, as JabRef's « Cleanup entries », each the smallest
// change of a field's value, offered before it is made:
// - pages: « 12-34 », « 12 – 34 » as BibTeX's range « 12--34 »;
// - latex: letters with accents and typographic characters as LaTeX
//   (« é » as {\'e}, « – » as --), which classic BibTeX needs;
// - capitals: the capitals a style must not lower put in braces in titles
//   (acronyms, « LaTeX », « 3D », and in a title written in sentence case the
//   proper nouns: « Monte Carlo »);
// - escape: &, %, # and _ outside math and URLs escaped, which LaTeX
//   otherwise stops at;
// - doi: a DOI without « https://doi.org/ » or « doi: »;
// - encoding: UTF-8 read once as Latin-1 or Windows-1252 and written so
//   (« TrÃ©panier », « acceptâ€“reject ») read again as it was meant.
import {
	type BibDocument,
	type BibField,
	formatBibValue,
	bracesBalance,
} from './bibDocument';
import { displayText } from './referenceSearch';

export type CleanupKind =
	| 'encoding'
	| 'pages'
	| 'doi'
	| 'escape'
	| 'latex'
	| 'capitals';

export const CLEANUP_KINDS: CleanupKind[] = [
	'encoding',
	'pages',
	'doi',
	'escape',
	'latex',
	'capitals',
];

export interface CleanupChange {
	/** The entry's index, its key, the field as written. */
	entry: number;
	key: string;
	field: string;
	before: string;
	after: string;
	kinds: CleanupKind[];
	/** The edit of the text: the value, as written. */
	from: number;
	to: number;
	insert: string;
}

/** How a capital is protected: the word ({Monte}) or its letter ({M}onte). */
export type CapitalStyle = 'word' | 'letter';

// Fields whose value is read as is, never as LaTeX text.
const VERBATIM = new Set([
	'url',
	'doi',
	'eprint',
	'file',
	'pdf',
	'isbn',
	'issn',
	'crossref',
	'xref',
	'ids',
	'related',
	'keywords',
	'urldate',
	'date',
	'eventdate',
	'origdate',
	'langid',
	'verba',
	'verbb',
	'verbc',
	'uri',
	// JabRef's own: groups, ranks, dates.
	'groups',
	'owner',
	'timestamp',
	'ranking',
	'readstatus',
	'priority',
	'printed',
	'qualityassured',
	'relevance',
	'creationdate',
	'modificationdate',
]);

/** A field read as is: those above, and vendors' (mendeley-tags, bdsk-url-1). */
const verbatim = (name: string) => VERBATIM.has(name) || name.includes('-');

/** A field's name, without the « OPT » of Emacs's optional fields. */
const nameOf = (field: BibField) =>
	field.name.toLowerCase().replace(/^opt(?=[a-z]{2})/, '');

// Titles, which styles may set in sentence case.
const TITLES = new Set(['title', 'subtitle', 'maintitle', 'mainsubtitle']);

// ---------------------------------------------------------------------------

const DASHES = '-‐‑‒–—−';
const PAGE = '(?:[A-Za-z]*\\d+[A-Za-z]*|[ivxlcdmIVXLCDM]+)';
const RANGE = new RegExp(`^(${PAGE})\\s*[${DASHES}]+\\s*(${PAGE})$`);

/** « 12-34 », « 12 – 34 », « e1—e9, 40-42 » with BibTeX's « -- ». */
export function cleanPages(value: string): string {
	const parts = value.split(/(\s*,\s*)/);
	return parts
		.map((part, index) => {
			if (index % 2) return part; // a separator
			const trimmed = part.trim();
			const range = RANGE.exec(trimmed);
			return range ? part.replace(trimmed, `${range[1]}--${range[2]}`) : part;
		})
		.join('');
}

/** A DOI without its link or « doi: ». */
export const cleanDoi = (value: string): string =>
	value.replace(/^\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');

// Windows-1252's characters for the bytes 0x80 to 0x9F.
const CP1252 = new Map<string, number>(
	[
		'€',
		'',
		'‚',
		'ƒ',
		'„',
		'…',
		'†',
		'‡',
		'ˆ',
		'‰',
		'Š',
		'‹',
		'Œ',
		'',
		'Ž',
		'',
		'',
		'‘',
		'’',
		'“',
		'”',
		'•',
		'–',
		'—',
		'˜',
		'™',
		'š',
		'›',
		'œ',
		'',
		'ž',
		'Ÿ',
	].flatMap((char, offset) =>
		char ? [[char, 0x80 + offset] as [string, number]] : [],
	),
);
const byteOf = (char: string): number | null => {
	const code = char.charCodeAt(0);
	if (code >= 0x80 && code <= 0xff) return code;
	return CP1252.get(char) ?? null;
};
// A lead byte read as a character, then the continuation bytes.
const MOJIBAKE =
	/[\u00C2-\u00F4][\u0080-\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]{1,3}/g;

/** The character UTF-8 writes with these bytes, or null. */
function utf8(bytes: number[]): string | null {
	const [lead, ...rest] = bytes;
	if (rest.some((byte) => (byte & 0xc0) !== 0x80)) return null;
	const low = (index: number) => rest[index] & 0x3f;
	let code: number;
	if (bytes.length === 2 && lead >= 0xc2 && lead <= 0xdf) {
		code = ((lead & 0x1f) << 6) | low(0);
	} else if (bytes.length === 3 && lead >= 0xe0 && lead <= 0xef) {
		code = ((lead & 0x0f) << 12) | (low(0) << 6) | low(1);
		if (code < 0x800 || (code >= 0xd800 && code <= 0xdfff)) return null;
	} else if (bytes.length === 4 && lead >= 0xf0 && lead <= 0xf4) {
		code = ((lead & 0x07) << 18) | (low(0) << 12) | (low(1) << 6) | low(2);
		if (code < 0x10000 || code > 0x10ffff) return null;
	} else {
		return null;
	}
	return String.fromCodePoint(code);
}

/** UTF-8 read as Latin-1 or Windows-1252 (« Ã© »), read as UTF-8 (« é »),
 * twice over if it was so. A sequence that is no UTF-8 stays. */
export function repairEncoding(value: string): string {
	let result = value;
	for (let pass = 0; pass < 3; pass++) {
		const next = result.replace(MOJIBAKE, (sequence) => {
			const bytes = [...sequence].map(byteOf);
			if (bytes.some((byte) => byte === null)) return sequence;
			const lead = bytes[0] as number;
			const length = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
			if (bytes.length < length) return sequence;
			const char = utf8(bytes.slice(0, length) as number[]);
			return char === null ? sequence : char + sequence.slice(length);
		});
		if (next === result) break;
		result = next;
	}
	return result;
}

// Commands whose argument is a URL or a path, left as is.
const URL_COMMANDS = new Set(['url', 'href', 'path', 'nolinkurl', 'doi']);

/** &, %, # and _ escaped, outside math and URLs. */
export function escapeSpecials(value: string): string {
	let result = '';
	let math = false;
	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if (char === '\\') {
			const name = /^[a-zA-Z]+/.exec(value.slice(i + 1))?.[0];
			if (!name) {
				// \&, \\, \{: as they are.
				result += value.slice(i, i + 2);
				i++;
				continue;
			}
			let end = i + 1 + name.length;
			if (URL_COMMANDS.has(name)) {
				while (value[end] === ' ') end++;
				if (value[end] === '{') {
					let depth = 0;
					for (; end < value.length; end++) {
						if (value[end] === '{') depth++;
						else if (value[end] === '}' && --depth === 0) {
							end++;
							break;
						}
					}
				}
			}
			result += value.slice(i, end);
			i = end - 1;
			continue;
		}
		// JabRef's « #may# »: a macro, written so.
		const macro = char === '#' ? /^#[A-Za-z]+#/.exec(value.slice(i)) : null;
		if (macro) {
			result += macro[0];
			i += macro[0].length - 1;
			continue;
		}
		if (char === '$') math = !math;
		result += !math && '&%#_'.includes(char) ? `\\${char}` : char;
	}
	return result;
}

// Marks of a decomposed letter, and the command writing each.
const MARKS: Record<string, string> = {
	'̀': '`',
	'́': "'",
	'̂': '^',
	'̃': '~',
	'̄': '=',
	'̆': 'u',
	'̇': '.',
	'̈': '"',
	'̊': 'r',
	'̋': 'H',
	'̌': 'v',
	'̣': 'd',
	'̧': 'c',
	'̨': 'k',
	'̱': 'b',
};
// Letters that are not a letter and a mark, and typography.
const SPECIAL = new Map<string, string>([
	['ß', '{\\ss}'],
	['æ', '{\\ae}'],
	['Æ', '{\\AE}'],
	['œ', '{\\oe}'],
	['Œ', '{\\OE}'],
	['ø', '{\\o}'],
	['Ø', '{\\O}'],
	['ł', '{\\l}'],
	['Ł', '{\\L}'],
	['ı', '{\\i}'],
	['å', '{\\aa}'],
	['Å', '{\\AA}'],
	['–', '--'],
	['—', '---'],
	['‘', '`'],
	['’', "'"],
	['“', '``'],
	['”', "''"],
	[' ', '~'],
	['…', '{\\ldots}'],
]);

/** A letter with its marks, in LaTeX: « é » is {\'e}, « ı̈ » {\"\i}. */
function letterInLatex(char: string): string | null {
	const [base, ...marks] = [...char.normalize('NFD')];
	if (!/^[A-Za-z]$/.test(base) || marks.length === 0) return null;
	if (!marks.every((mark) => mark in MARKS)) return null;
	// The dotless i and j under a mark above.
	let written = base === 'i' || base === 'j' ? `\\${base}` : base;
	for (const mark of marks) {
		const command = MARKS[mark];
		written = /[a-zA-Z]/.test(command)
			? `\\${command}{${written}}`
			: `\\${command}${written.length > 1 && !/^\\[ij]$/.test(written) ? `{${written}}` : written}`;
	}
	return `{${written}}`;
}

/** Accented letters and typographic characters as LaTeX; others kept. */
export function unicodeToLatex(value: string): string {
	let result = '';
	for (const char of value.normalize('NFC')) {
		if (char.charCodeAt(0) < 128) {
			result += char;
			continue;
		}
		const written = SPECIAL.get(char) ?? letterInLatex(char);
		if (!written) {
			result += char;
			continue;
		}
		// « H\ärdle », a backslash typed before the letter: the letter's.
		if (/(^|[^\\])(\\\\)*\\$/.test(result)) result = result.slice(0, -1);
		result += written;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Capitals

interface Word {
	from: number;
	to: number;
	text: string;
	/** After a colon, a question or an exclamation mark: BibTeX's « t »
	 * style keeps its capital. */
	starts: boolean;
}

const SEPARATOR = /[\s\-/:;,.?!()[\]"'`~]/;
// A special character in braces: {\'e}, {\v{c}}, {\ss}.
const SPECIAL_GROUP = /\{\\(?:[^{}]|\{[^{}]*\})*\}/g;

/** The words of a value at brace depth 0, a brace group part of its word. */
function wordsOf(value: string): Word[] {
	const words: Word[] = [];
	let start = -1;
	let starts = true;
	const close = (end: number) => {
		if (start >= 0) {
			words.push({
				from: start,
				to: end,
				text: value.slice(start, end),
				starts,
			});
			starts = false;
		}
		start = -1;
	};
	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if (char === '{') {
			if (start < 0) start = i;
			let depth = 0;
			for (; i < value.length; i++) {
				if (value[i] === '{') depth++;
				else if (value[i] === '}' && --depth === 0) break;
			}
			continue;
		}
		if (char === '\\') {
			if (start < 0) start = i;
			i++;
			while (/[a-zA-Z]/.test(value[i + 1] ?? '')) i++;
			continue;
		}
		if (char === '$') {
			// Math: a word of its own, left as is.
			close(i);
			const end = value.indexOf('$', i + 1);
			words.push({
				from: i,
				to: end < 0 ? value.length : end + 1,
				text: value.slice(i, end < 0 ? value.length : end + 1),
				starts: false,
			});
			i = end < 0 ? value.length : end;
			continue;
		}
		if (SEPARATOR.test(char)) {
			close(i);
			if (/[:?!]/.test(char)) starts = true;
			continue;
		}
		if (start < 0) start = i;
	}
	close(value.length);
	return words;
}

/** A title in sentence case: most of its longer words in lower case. */
function sentenceCase(words: Word[]): boolean {
	const later = words
		.filter((word) => !word.starts)
		.map((word) => displayText(word.text))
		.filter((text) => text.length >= 4 && /^\p{L}/u.test(text));
	if (later.length === 0) return true;
	const capitalized = later.filter((text) => /^\p{Lu}/u.test(text)).length;
	return capitalized * 2 <= later.length;
}

/** The capitals of a title a style must not lower, in braces. */
export function protectCapitals(
	value: string,
	style: CapitalStyle = 'word',
): string {
	const plain = displayText(value);
	// ALL CAPS, or nothing to protect.
	if (!/\p{Ll}/u.test(plain) || !/\p{Lu}/u.test(plain)) return value;
	const words = wordsOf(value);
	const sentence = sentenceCase(words);
	let result = '';
	let at = 0;
	for (const word of words) {
		const text = word.text;
		// Math, a protected group, or a command other than an accent.
		if (text.startsWith('$')) continue;
		const bare = text.replace(SPECIAL_GROUP, '');
		if (/\{(?!\\)/.test(bare) || /\\[a-zA-Z]{2,}/.test(bare)) continue;
		const letters = displayText(text).replace(/[^\p{L}\p{N}]/gu, '');
		if (!/\p{Lu}/u.test(letters)) continue;
		const inner = /\p{Lu}/u.test(letters.slice(1));
		const proper =
			sentence &&
			!word.starts &&
			/^\p{Lu}/u.test(letters) &&
			!(letters === 'A' || letters === 'I');
		const lone = letters.length === 1 && !word.starts && letters !== 'A';
		if (!inner && !proper && !lone) continue;
		const wrapped =
			style === 'letter' && !inner && /^[A-Z][a-z]/.test(text)
				? `{${text[0]}}${text.slice(1)}`
				: `{${text}}`;
		result += value.slice(at, word.from) + wrapped;
		at = word.to;
	}
	return result + value.slice(at);
}

/** How the file protects capitals: {Monte} or {M}onte, by most titles. */
export function capitalStyleOf(document: BibDocument): CapitalStyle {
	let letters = 0;
	let words = 0;
	for (const entry of document.entries) {
		for (const field of entry.fields) {
			if (!TITLES.has(nameOf(field))) continue;
			letters += (field.value.match(/\{[A-Z]\}[a-z]/g) ?? []).length;
			words += (field.value.match(/\{[A-Z][a-z]+\}/g) ?? []).length;
		}
	}
	return letters > words ? 'letter' : 'word';
}

// ---------------------------------------------------------------------------

/** A field's value after the cleanups asked, and which changed it. */
export function cleanField(
	field: BibField,
	kinds: Set<CleanupKind>,
	style: CapitalStyle = 'word',
): { value: string; kinds: CleanupKind[] } {
	const name = nameOf(field);
	const applied: CleanupKind[] = [];
	let value = field.value;
	const step = (
		kind: CleanupKind,
		applies: boolean,
		change: (v: string) => string,
	) => {
		if (!kinds.has(kind) || !applies) return;
		const next = change(value);
		if (next !== value) {
			value = next;
			applied.push(kind);
		}
	};
	step('encoding', true, repairEncoding);
	step('pages', name === 'pages', cleanPages);
	step('doi', name === 'doi', cleanDoi);
	step('escape', !verbatim(name), escapeSpecials);
	step('latex', !verbatim(name), unicodeToLatex);
	step('capitals', TITLES.has(name), (v) => protectCapitals(v, style));
	return { value, kinds: applied };
}

/**
 * The cleanups of the entries given (all by default), each change the
 * value of one field. Values written as macros or numbers are left.
 */
export function cleanupChanges(
	document: BibDocument,
	kinds: Set<CleanupKind>,
	entries?: number[],
): CleanupChange[] {
	const style = capitalStyleOf(document);
	const changes: CleanupChange[] = [];
	const indices = entries ?? document.entries.map((_, index) => index);
	for (const index of indices) {
		const entry = document.entries[index];
		if (!entry || entry.error || entry.close === null) continue;
		for (const field of entry.fields) {
			if (field.form !== 'braced' && field.form !== 'quoted') continue;
			// Comments or tracked changes of the review: changed in the text.
			if (field.value.includes('<###')) continue;
			const cleaned = cleanField(field, kinds, style);
			if (cleaned.kinds.length === 0 || !bracesBalance(cleaned.value)) continue;
			let insert: string;
			try {
				insert = formatBibValue(cleaned.value, field.form);
			} catch {
				continue;
			}
			changes.push({
				entry: index,
				key: entry.key,
				field: field.name,
				before: field.value,
				after: cleaned.value,
				kinds: cleaned.kinds,
				from: field.valueFrom,
				to: field.valueTo,
				insert,
			});
		}
	}
	return changes;
}
