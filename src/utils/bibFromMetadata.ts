// src/utils/bibFromMetadata.ts
// A work's metadata, from doi.org (CSL-JSON, as Crossref and DataCite give
// it) or Open Library, as a BibTeX or biblatex entry: the type and fields
// each dialect expects, the text in LaTeX (special characters escaped,
// Crossref's <i> and <sub> as \emph and \textsubscript, acronyms of titles
// in braces so styles keep their capitals), and a key as « einstein1935 ».
import type { BibDialect } from './bibEntryTypes';

export interface Person {
	family?: string;
	given?: string;
	/** An institution, written in braces; or, `plain`, a name as « First
	 * Last » that BibTeX splits itself (Open Library's). */
	literal?: string;
	plain?: boolean;
}

export interface WorkMetadata {
	/** CSL's type, or Crossref's (journal-article, book-chapter…). */
	type: string;
	title?: string;
	subtitle?: string;
	authors: Person[];
	editors: Person[];
	/** The journal, or the book or proceedings a part is in. */
	container?: string;
	series?: string;
	volume?: string;
	issue?: string;
	pages?: string;
	edition?: string;
	publisher?: string;
	place?: string;
	/** [year, month?, day?] */
	issued?: number[];
	/** A thesis's or a report's kind, as « PhD thesis ». */
	genre?: string;
	doi?: string;
	url?: string;
	isbn?: string;
	arxiv?: { id: string; primaryClass?: string };
}

export interface NewBibEntry {
	type: string;
	/** In order; values written in LaTeX, braces balanced. A month in
	 * BibTeX is a macro (« jun »), written without braces. */
	fields: [string, string][];
}

// ---------------------------------------------------------------------------
// Reading CSL-JSON and Open Library.

const text = (value: unknown): string | undefined => {
	if (Array.isArray(value)) return text(value[0]);
	if (typeof value === 'number') return String(value);
	if (typeof value !== 'string') return undefined;
	const trimmed = value.replace(/\s+/g, ' ').trim();
	return trimmed || undefined;
};

const people = (value: unknown): Person[] =>
	Array.isArray(value)
		? value
				.map((person) => {
					const record = (person ?? {}) as Record<string, unknown>;
					return {
						family: text(record.family),
						given: text(record.given),
						literal: text(record.literal) ?? text(record.name),
					};
				})
				.filter((person) => person.family || person.literal)
		: [];

const dateParts = (value: unknown): number[] | undefined => {
	const parts = (value as { 'date-parts'?: unknown[][] } | undefined)?.[
		'date-parts'
	]?.[0];
	if (!Array.isArray(parts) || typeof parts[0] !== 'number') return undefined;
	return parts.filter((part): part is number => typeof part === 'number');
};

// Parts of a book: Crossref lists the series, then the book.
const PART_OF_BOOK = /chapter|book-part|book-section|reference-entry|entry-/;

/** CSL-JSON, as doi.org returns it, or Crossref's own /works record. */
export function fromCsl(csl: Record<string, unknown>): WorkMetadata {
	const type = text(csl.type) ?? 'misc';
	const containers = (
		Array.isArray(csl['container-title'])
			? csl['container-title']
			: [csl['container-title']]
	)
		.map(text)
		.filter((title): title is string => Boolean(title));
	const inBook = PART_OF_BOOK.test(type) && containers.length > 1;
	const issued =
		dateParts(csl.issued) ??
		dateParts(csl['published-print']) ??
		dateParts(csl['published-online']) ??
		dateParts(csl.created);
	const title = text(csl.title);
	const subtitle = text(csl.subtitle);
	return {
		type,
		title,
		subtitle: subtitle && subtitle !== title ? subtitle : undefined,
		authors: people(csl.author),
		editors: people(csl.editor),
		container: inBook ? containers[containers.length - 1] : containers[0],
		series:
			text(csl['collection-title']) ?? (inBook ? containers[0] : undefined),
		volume: text(csl.volume),
		issue: text(csl.issue),
		pages: text(csl.page),
		edition: text(csl.edition) ?? text(csl['edition-number']),
		publisher: text(csl.publisher),
		place: text(csl['publisher-place']) ?? text(csl['publisher-location']),
		issued,
		genre: text(csl.genre),
		doi: text(csl.DOI),
		url: text(csl.URL),
		isbn: text(csl.ISBN),
	};
}

/** The arXiv category CSL lists first: « Machine Learning (cs.LG) ». */
export function arxivCategory(
	csl: Record<string, unknown>,
): string | undefined {
	const categories = Array.isArray(csl.categories) ? csl.categories : [];
	for (const category of categories) {
		const code = /\(([a-z-]+(?:\.[A-Za-z-]+)?)\)\s*$/.exec(
			String(category),
		)?.[1];
		if (code) return code;
	}
	return undefined;
}

/** Open Library's « data » record of a book. */
export function fromOpenLibrary(
	record: Record<string, unknown>,
	isbn: string,
): WorkMetadata {
	const names = (value: unknown): string[] =>
		Array.isArray(value)
			? value
					.map((item) => text((item as { name?: unknown })?.name))
					.filter((name): name is string => Boolean(name))
			: [];
	const year = /\b(\d{4})\b/.exec(text(record.publish_date) ?? '')?.[1];
	return {
		type: 'book',
		title: text(record.title),
		subtitle: text(record.subtitle),
		// « Donald Knuth »: BibTeX reads « First Last » itself.
		authors: names(record.authors).map((literal) => ({ literal, plain: true })),
		editors: [],
		publisher: names(record.publishers)[0],
		place: names(record.publish_places)[0],
		issued: year ? [Number(year)] : undefined,
		isbn,
	};
}

// ---------------------------------------------------------------------------
// LaTeX.

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

const decodeEntities = (value: string): string =>
	value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] === '#') {
			const code =
				name[1] === 'x' || name[1] === 'X'
					? Number.parseInt(name.slice(2), 16)
					: Number.parseInt(name.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});

/** Text with LaTeX's special characters escaped. */
export function latexEscape(value: string): string {
	return value
		.replace(/\\/g, '\uE000')
		.replace(/([{}&%$#_])/g, '\\$1')
		.replace(/~/g, '\\textasciitilde{}')
		.replace(/\^/g, '\\textasciicircum{}')
		.replace(/\uE000/g, '\\textbackslash{}')
		.replace(/\u00a0/g, '~');
}

// Words styles must not lower: « DNA », « LaTeX », « mRNA », « GPUs ».
const protectWords = (value: string): string => {
	if (!/[a-z]/.test(value)) return value; // ALL CAPS: left as given.
	return value.replace(/[^\s\-–—/:;,.?!()"]+/g, (word, offset: number) => {
		if (/[\\{}]/.test(word)) return word;
		const letters = word.replace(/[^\p{L}]/gu, '');
		// « LaTeX », and a capital standing alone (« Large N », « Part I »),
		// but not the article « A ».
		const inner = letters.length > 1 && /\p{Lu}/u.test(letters.slice(1));
		const single =
			letters.length === 1 &&
			/\p{Lu}/u.test(letters) &&
			letters !== 'A' &&
			offset > 0;
		return inner || single ? `{${word}}` : word;
	});
};

const TAGS: Record<string, string> = {
	i: '\\emph{',
	em: '\\emph{',
	b: '\\textbf{',
	strong: '\\textbf{',
	sub: '\\textsubscript{',
	sup: '\\textsuperscript{',
	scp: '\\textsc{',
};

/**
 * Metadata text (which may hold Crossref's HTML tags and entities) in
 * LaTeX; `protect` puts a title's acronyms in braces.
 */
export function toLatex(value: string, protect = false): string {
	let result = '';
	const open: string[] = [];
	for (const piece of value.split(/(<\/?[a-zA-Z][\w:-]*(?:\s[^>]*)?>)/)) {
		const tag = /^<(\/?)([a-zA-Z][\w:-]*)/.exec(piece);
		if (tag) {
			const name = tag[2].toLowerCase();
			if (!(name in TAGS)) continue; // MathML and the like: their text stays.
			if (!tag[1]) {
				result += TAGS[name];
				open.push(name);
			} else if (open[open.length - 1] === name) {
				result += '}';
				open.pop();
			}
			continue;
		}
		const escaped = latexEscape(decodeEntities(piece));
		result += protect ? protectWords(escaped) : escaped;
	}
	return result + '}'.repeat(open.length);
}

/** « Family, Given », « {Institution} », or « First Last » as given. */
function writeName(person: Person): string {
	if (person.literal) {
		const literal = toLatex(person.literal);
		return person.plain ? literal : `{${literal}}`;
	}
	const family = toLatex(person.family ?? '');
	return person.given ? `${family}, ${toLatex(person.given)}` : family;
}

const writeNames = (list: Person[]): string =>
	list.map(writeName).join(' and ');

// ---------------------------------------------------------------------------
// Types and fields.

const MONTHS = [
	'jan',
	'feb',
	'mar',
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec',
];

const KIND: Record<string, string> = {
	'article-journal': 'article',
	'journal-article': 'article',
	'article-magazine': 'article',
	'article-newspaper': 'article',
	'paper-conference': 'inproceedings',
	'proceedings-article': 'inproceedings',
	chapter: 'incollection',
	'book-chapter': 'incollection',
	'book-section': 'incollection',
	'book-part': 'incollection',
	'entry-encyclopedia': 'incollection',
	'entry-dictionary': 'incollection',
	'reference-entry': 'incollection',
	book: 'book',
	monograph: 'book',
	'edited-book': 'book',
	'reference-book': 'book',
	proceedings: 'proceedings',
	report: 'report',
	'report-component': 'report',
	thesis: 'thesis',
	dissertation: 'thesis',
	dataset: 'dataset',
	software: 'software',
	webpage: 'online',
	'post-weblog': 'online',
	post: 'online',
};

/** The entry type for a work, in a dialect. */
function entryType(meta: WorkMetadata, dialect: BibDialect): string {
	if (meta.arxiv) return 'misc';
	const kind = KIND[meta.type] ?? 'misc';
	if (dialect === 'biblatex') return kind;
	switch (kind) {
		case 'report':
			return 'techreport';
		case 'thesis':
			return /master|m\.?sc|mémoire/i.test(meta.genre ?? '')
				? 'mastersthesis'
				: 'phdthesis';
		case 'dataset':
		case 'software':
		case 'online':
			return 'misc';
		default:
			return kind;
	}
}

const pagesRange = (pages: string): string =>
	pages.replace(/\s*[-–—]+\s*/g, '--');

/** The entry for a work, in the dialect's types and fields. */
export function toBibEntry(
	meta: WorkMetadata,
	dialect: BibDialect,
): NewBibEntry {
	const type = entryType(meta, dialect);
	const biblatex = dialect === 'biblatex';
	const fields: [string, string][] = [];
	const add = (name: string, value: string | undefined) => {
		if (value?.trim()) fields.push([name, value]);
	};

	const authors = meta.authors.length ? meta.authors : [];
	add('author', writeNames(authors));
	// Editors: of the book a part is in, or of a book without authors.
	if (
		meta.editors.length &&
		(!authors.length || ['incollection', 'inproceedings'].includes(type))
	) {
		add('editor', writeNames(meta.editors));
	}

	const title = meta.title ? toLatex(meta.title, true) : undefined;
	const subtitle = meta.subtitle ? toLatex(meta.subtitle, true) : undefined;
	if (biblatex) {
		add('title', title);
		add('subtitle', subtitle);
	} else {
		add(
			'title',
			title && subtitle ? `${title}: ${subtitle}` : (title ?? subtitle),
		);
	}

	const container = meta.container ? toLatex(meta.container, true) : undefined;
	if (type === 'article') add(biblatex ? 'journaltitle' : 'journal', container);
	else if (type === 'incollection' || type === 'inproceedings')
		add('booktitle', container);
	// A book's container is its series, for Crossref.
	const series = meta.series ? toLatex(meta.series, true) : undefined;
	if (type === 'book' || type === 'proceedings')
		add('series', container ?? series);
	else add('series', series);

	add('volume', meta.volume && toLatex(meta.volume));
	add('number', meta.issue && toLatex(meta.issue));
	add('pages', meta.pages && pagesRange(toLatex(meta.pages)));
	add('edition', meta.edition && toLatex(meta.edition));

	const publisher = meta.publisher && toLatex(meta.publisher);
	const place = meta.place && toLatex(meta.place);
	if (type === 'thesis' || type === 'phdthesis' || type === 'mastersthesis') {
		add(biblatex ? 'institution' : 'school', publisher);
		if (biblatex)
			add(
				'type',
				/master|m\.?sc|mémoire/i.test(meta.genre ?? '')
					? 'mathesis'
					: 'phdthesis',
			);
	} else if (type === 'techreport' || type === 'report') {
		add('institution', publisher);
		if (biblatex) add('type', 'techreport');
	} else if (!meta.arxiv) {
		add('publisher', publisher);
	}
	add(biblatex ? 'location' : 'address', place);

	const [year, month, day] = meta.issued ?? [];
	if (biblatex && year) {
		const pad = (part: number) => String(part).padStart(2, '0');
		add(
			'date',
			[String(year), month && pad(month), month && day && pad(day)]
				.filter(Boolean)
				.join('-'),
		);
	} else if (year) {
		add('year', String(year));
		if (month && month >= 1 && month <= 12 && !meta.arxiv)
			add('month', MONTHS[month - 1]);
	}

	if (meta.isbn && (type === 'book' || type === 'proceedings'))
		add('isbn', meta.isbn);
	if (meta.arxiv) {
		add('eprint', meta.arxiv.id);
		if (biblatex) {
			add('eprinttype', 'arxiv');
			add('eprintclass', meta.arxiv.primaryClass);
		} else {
			add('archiveprefix', 'arXiv');
			add('primaryclass', meta.arxiv.primaryClass);
		}
		add('doi', `10.48550/arXiv.${meta.arxiv.id}`);
		add('url', `https://arxiv.org/abs/${meta.arxiv.id}`);
	} else {
		// As written: biblatex and hyperref read it verbatim.
		add('doi', meta.doi?.replace(/[{}\s]/g, ''));
		if (!meta.doi && meta.url && /^https?:\/\//i.test(meta.url)) {
			add('url', meta.url.replace(/[{}\s]/g, encodeURIComponent));
		}
	}
	return { type, fields };
}

// ---------------------------------------------------------------------------
// Keys.

const FOLD = new Map<string, string>([
	['ß', 'ss'],
	['ø', 'o'],
	['æ', 'ae'],
	['œ', 'oe'],
	['ł', 'l'],
	['đ', 'd'],
	['þ', 'th'],
]);

const STOPWORDS = new Set([
	'the',
	'and',
	'for',
	'les',
	'des',
	'der',
	'die',
	'das',
	'del',
	'los',
	'las',
]);

const asciiWord = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[ßøæœłđþ]/g, (letter) => FOLD.get(letter) ?? letter)
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^a-z]/g, '');

/**
 * A key as « einstein1935 »: the first author's (or editor's) family name,
 * then the year; « a », « b »… after it when the file has it already.
 * Capitalized (« Einstein1935 ») when the file's keys mostly are.
 */
export function makeKey(meta: WorkMetadata, taken: string[]): string {
	const person = meta.authors[0] ?? meta.editors[0];
	// « The pandas development team »: its first word that says something;
	// « Donald Knuth » (as Open Library writes names): the last.
	const literalWords = (person?.literal ?? '').split(/\s+/);
	const name =
		person?.family ??
		(person?.plain
			? literalWords[literalWords.length - 1]
			: literalWords.find(
					(word) =>
						asciiWord(word).length > 2 && !STOPWORDS.has(asciiWord(word)),
				)) ??
		'';
	const firstWord = (meta.title ?? '')
		.split(/\s+/)
		.find((word) => asciiWord(word).length > 3);
	let stem = asciiWord(name) || asciiWord(firstWord ?? '') || 'ref';
	const styled = taken.filter((key) => /^[A-Za-z]+\d{4}/.test(key));
	if (
		styled.length &&
		styled.filter((key) => /^[A-Z]/.test(key)).length > styled.length / 2
	) {
		stem = stem[0].toUpperCase() + stem.slice(1);
	}
	const base = `${stem}${meta.issued?.[0] ?? ''}`;
	const used = new Set(taken.map((key) => key.toLowerCase()));
	if (!used.has(base.toLowerCase())) return base;
	for (let i = 0; i < 26 * 27; i++) {
		const suffix =
			i < 26
				? String.fromCharCode(97 + i)
				: String.fromCharCode(96 + Math.floor(i / 26)) +
					String.fromCharCode(97 + (i % 26));
		if (!used.has(`${base}${suffix}`.toLowerCase())) return `${base}${suffix}`;
	}
	return `${base}-${Date.now()}`;
}
