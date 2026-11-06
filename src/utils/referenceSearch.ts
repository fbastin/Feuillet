// src/utils/referenceSearch.ts
// The references a \cite{…} finds, as Overleaf's advanced reference search:
// every word typed is in the key, the authors, the title, the year or the
// journal, in any order, whatever the case and the accents (also BibTeX's,
// as {\'e} or {\"o}).

export interface SearchableReference {
	key: string;
	title: string;
	/** BibTeX author fields: « Last, First and Other, Name ». */
	authors: string[];
	year: string;
	journal?: string;
}

// BibTeX's accents, as {\'e} or \"{o}, and the combining marks they are.
const ACCENTS: Record<string, string> = {
	"'": '\u0301',
	'`': '\u0300',
	'^': '\u0302',
	'"': '\u0308',
	'~': '\u0303',
	'=': '\u0304',
	'.': '\u0307',
	u: '\u0306',
	v: '\u030c',
	H: '\u030b',
	c: '\u0327',
	k: '\u0328',
	r: '\u030a',
};

// Letters written as commands in BibTeX.
const LETTERS: Record<string, string> = {
	ss: 'ß',
	o: 'ø',
	O: 'Ø',
	ae: 'æ',
	AE: 'Æ',
	oe: 'œ',
	OE: 'Œ',
	aa: 'å',
	AA: 'Å',
	l: 'ł',
	L: 'Ł',
	i: 'ı',
	j: 'ȷ',
};

/** BibTeX text as it reads: « K{\"o}rper » is « Körper ». */
export const displayText = (text: string): string =>
	text
		.replace(
			/\\(['`^"~=.])\s*(?:\{\s*([a-zA-Z]|\\[ij])\s*\}|([a-zA-Z]|\\[ij]\b))/g,
			(_, accent: string, braced?: string, bare?: string) =>
				`${(braced ?? bare ?? '').replace(/^\\/, '')}${ACCENTS[accent]}`,
		)
		.replace(
			/\\([uvHckr])\s*(?:\{\s*([a-zA-Z])\s*\}|\s([a-zA-Z]))/g,
			(_, accent: string, braced?: string, bare?: string) =>
				`${braced ?? bare ?? ''}${ACCENTS[accent]}`,
		)
		.replace(
			/\\([a-zA-Z]+)\*?(?:\{\}|\s+)?/g,
			(_, name: string) => LETTERS[name] ?? '',
		)
		.replace(/\\([&%$#_{}])/g, '$1')
		.replace(/\\./g, '')
		.replace(/[{}$]/g, '')
		.replace(/~/g, ' ')
		.replace(/---/g, '—')
		.replace(/--/g, '–')
		.replace(/\s+/g, ' ')
		.normalize('NFC')
		.trim();

// Letters that are not a base letter and a mark.
const FOLDED = new Map([
	['ß', 'ss'],
	['ø', 'o'],
	['æ', 'ae'],
	['œ', 'oe'],
	['ł', 'l'],
	['ı', 'i'],
	['ȷ', 'j'],
	['đ', 'd'],
	['þ', 'th'],
]);

/** Text as typed to find it: no LaTeX, no accents, lower case. */
export const plainText = (text: string): string =>
	displayText(text)
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[ßøæœłıȷđþ]/g, (letter) => FOLDED.get(letter) ?? letter)
		.replace(/\s+/g, ' ')
		.trim();

/** The authors' last names, from BibTeX's « Last, First and First Last ». */
export const authorSurnames = (authors: string[]): string[] =>
	authors
		.flatMap((field) => field.split(/\s+and\s+/i))
		.map((author) => author.trim())
		.filter((author) => author && author.toLowerCase() !== 'others')
		.map((author) => {
			const comma = author.indexOf(',');
			if (comma >= 0) return author.slice(0, comma).trim();
			// « Jean {de La Fontaine} »: the last braced group, else the last
			// word (« Jos{\'e} » keeps its accent).
			const braced = /(?:^|\s)(\{[^{}]*\})\s*$/.exec(author)?.[1];
			if (braced) return braced;
			return author.split(/\s+/).pop() ?? author;
		})
		.map(displayText);

/** « Einstein », « Einstein, Podolsky » or « Einstein et al. ». */
export const authorsLabel = (authors: string[]): string => {
	const surnames = authorSurnames(authors);
	if (surnames.length === 0) return '';
	if (surnames.length <= 2) return surnames.join(', ');
	return `${surnames[0]} et al.`;
};

interface Prepared {
	key: string;
	authors: string;
	surnames: string[];
	title: string;
	titleWords: string[];
	year: string;
	journal: string;
}

const prepared = new WeakMap<SearchableReference, Prepared>();

const prepare = (entry: SearchableReference): Prepared => {
	let fields = prepared.get(entry);
	if (!fields) {
		const title = plainText(entry.title);
		fields = {
			key: entry.key.toLowerCase(),
			authors: plainText(entry.authors.join(' and ')),
			surnames: authorSurnames(entry.authors).map(plainText),
			title,
			titleWords: title.split(/[\s\-–—:;,.()]+/).filter(Boolean),
			year: entry.year.trim(),
			journal: plainText(entry.journal ?? ''),
		};
		prepared.set(entry, fields);
	}
	return fields;
};

// How well one word matches an entry; 0 when it is nowhere.
const termScore = (fields: Prepared, term: string): number => {
	let score = 0;
	if (fields.key.startsWith(term)) score = Math.max(score, 100);
	else if (fields.key.includes(term)) score = Math.max(score, 60);
	if (fields.surnames.some((surname) => surname.startsWith(term))) {
		score = Math.max(score, 50);
	} else if (fields.authors.includes(term)) {
		score = Math.max(score, 30);
	}
	if (fields.year === term) score = Math.max(score, 40);
	else if (fields.year.startsWith(term)) score = Math.max(score, 20);
	if (fields.titleWords.some((word) => word.startsWith(term))) {
		score = Math.max(score, 25);
	} else if (fields.title.includes(term)) {
		score = Math.max(score, 10);
	}
	if (fields.journal.includes(term)) score = Math.max(score, 10);
	return score;
};

/**
 * The entries every word of `query` is found in, best first: the key's
 * beginning, then an author's name, the year, the title, the journal. An
 * empty query gives the entries by key.
 */
export function searchReferences<T extends SearchableReference>(
	entries: T[],
	query: string,
	limit = 20,
): T[] {
	const terms = plainText(query).split(' ').filter(Boolean);
	const scored: { entry: T; score: number }[] = [];
	for (const entry of entries) {
		const fields = prepare(entry);
		let score = 0;
		let found = true;
		for (const term of terms) {
			const one = termScore(fields, term);
			if (one === 0) {
				found = false;
				break;
			}
			score += one;
		}
		if (found) scored.push({ entry, score });
	}
	return scored
		.sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
		.slice(0, limit)
		.map(({ entry }) => entry);
}
