// src/utils/bibEntryTypes.ts
// The fields each entry type takes, as JabRef lists them in its BibTeX and
// biblatex modes: required ones (one of « author/editor » will do), then
// optional ones. BibTeX's are those of btxdoc (Patashnik); biblatex's those
// of its manual, section 2.1, with the aliases biber accepts (« journal »
// for « journaltitle », « address » for « location », @phdthesis for
// @thesis…).

export type BibDialect = 'bibtex' | 'biblatex';

/** A required slot: one field, or several of which one will do. */
export type RequiredSlot = string | string[];

export interface EntryTypeSchema {
	required: RequiredSlot[];
	optional: string[];
}

// Fields JabRef shows for every entry, after the type's own.
const GENERAL_BIBTEX = [
	'doi',
	'url',
	'urldate',
	'isbn',
	'issn',
	'keywords',
	'abstract',
	'crossref',
	'key',
];

const GENERAL_BIBLATEX = [
	'keywords',
	'abstract',
	'langid',
	'shorthand',
	'shorttitle',
	'crossref',
	'xref',
	'related',
	'options',
	'file',
];

const bibtex = (
	required: RequiredSlot[],
	optional: string[],
): EntryTypeSchema => ({ required, optional });

export const BIBTEX_TYPES: Record<string, EntryTypeSchema> = {
	article: bibtex(
		['author', 'title', 'journal', 'year'],
		['volume', 'number', 'pages', 'month', 'note'],
	),
	book: bibtex(
		[['author', 'editor'], 'title', 'publisher', 'year'],
		['volume', 'number', 'series', 'address', 'edition', 'month', 'note'],
	),
	booklet: bibtex(
		['title'],
		['author', 'howpublished', 'address', 'month', 'year', 'note'],
	),
	inbook: bibtex(
		[['author', 'editor'], 'title', ['chapter', 'pages'], 'publisher', 'year'],
		[
			'volume',
			'number',
			'series',
			'type',
			'address',
			'edition',
			'month',
			'note',
		],
	),
	incollection: bibtex(
		['author', 'title', 'booktitle', 'publisher', 'year'],
		[
			'editor',
			'volume',
			'number',
			'series',
			'type',
			'chapter',
			'pages',
			'address',
			'edition',
			'month',
			'note',
		],
	),
	inproceedings: bibtex(
		['author', 'title', 'booktitle', 'year'],
		[
			'editor',
			'volume',
			'number',
			'series',
			'pages',
			'address',
			'month',
			'organization',
			'publisher',
			'note',
		],
	),
	manual: bibtex(
		['title'],
		['author', 'organization', 'address', 'edition', 'month', 'year', 'note'],
	),
	mastersthesis: bibtex(
		['author', 'title', 'school', 'year'],
		['type', 'address', 'month', 'note'],
	),
	misc: bibtex(
		[],
		['author', 'title', 'howpublished', 'month', 'year', 'note'],
	),
	phdthesis: bibtex(
		['author', 'title', 'school', 'year'],
		['type', 'address', 'month', 'note'],
	),
	proceedings: bibtex(
		['title', 'year'],
		[
			'editor',
			'volume',
			'number',
			'series',
			'address',
			'month',
			'organization',
			'publisher',
			'note',
		],
	),
	techreport: bibtex(
		['author', 'title', 'institution', 'year'],
		['type', 'number', 'address', 'month', 'note'],
	),
	unpublished: bibtex(['author', 'title', 'note'], ['month', 'year']),
};

// BibTeX's @conference is @inproceedings.
BIBTEX_TYPES.conference = BIBTEX_TYPES.inproceedings;

// Groups of biblatex's optional fields, shared by many types.
const EDITORS = ['editor', 'editora', 'editorb', 'editorc'];
const CONTRIBUTORS = ['translator', 'annotator', 'commentator'];
const BOOK_CONTRIBUTORS = ['introduction', 'foreword', 'afterword'];
const TITLE = ['subtitle', 'titleaddon'];
const MAIN_TITLE = ['maintitle', 'mainsubtitle', 'maintitleaddon'];
const BOOK_TITLE = ['booksubtitle', 'booktitleaddon'];
const LANGUAGE = ['language', 'origlanguage'];
const EVENT = ['eventtitle', 'eventtitleaddon', 'eventdate', 'venue'];
const PAGES = ['eid', 'chapter', 'pages'];
const END = [
	'addendum',
	'pubstate',
	'doi',
	'eprint',
	'eprintclass',
	'eprinttype',
	'url',
	'urldate',
];

const biblatex = (
	required: RequiredSlot[],
	...optional: (string | string[])[]
): EntryTypeSchema => ({
	required: [...required, ['date', 'year']],
	optional: [...new Set(optional.flat())].filter(
		(field) =>
			!required.flat().includes(field) && field !== 'date' && field !== 'year',
	),
});

const BOOK = biblatex(
	['author', 'title'],
	EDITORS,
	CONTRIBUTORS,
	BOOK_CONTRIBUTORS,
	TITLE,
	MAIN_TITLE,
	LANGUAGE,
	'volume',
	'part',
	'edition',
	'volumes',
	'series',
	'number',
	'note',
	'publisher',
	'location',
	'isbn',
	PAGES,
	'pagetotal',
	END,
);

const MV_BOOK = biblatex(
	['author', 'title'],
	EDITORS,
	CONTRIBUTORS,
	BOOK_CONTRIBUTORS,
	TITLE,
	LANGUAGE,
	'edition',
	'volumes',
	'series',
	'number',
	'note',
	'publisher',
	'location',
	'isbn',
	'pagetotal',
	END,
);

const IN_BOOK = biblatex(
	['author', 'title', 'booktitle'],
	'bookauthor',
	EDITORS,
	CONTRIBUTORS,
	BOOK_CONTRIBUTORS,
	TITLE,
	MAIN_TITLE,
	BOOK_TITLE,
	LANGUAGE,
	'volume',
	'part',
	'edition',
	'volumes',
	'series',
	'number',
	'note',
	'publisher',
	'location',
	'isbn',
	PAGES,
	END,
);

const COLLECTION = biblatex(
	['editor', 'title'],
	['editora', 'editorb', 'editorc'],
	CONTRIBUTORS,
	BOOK_CONTRIBUTORS,
	TITLE,
	MAIN_TITLE,
	LANGUAGE,
	'volume',
	'part',
	'edition',
	'volumes',
	'series',
	'number',
	'note',
	'publisher',
	'location',
	'isbn',
	PAGES,
	'pagetotal',
	END,
);

const MV_COLLECTION = biblatex(
	['editor', 'title'],
	['editora', 'editorb', 'editorc'],
	CONTRIBUTORS,
	BOOK_CONTRIBUTORS,
	TITLE,
	LANGUAGE,
	'edition',
	'volumes',
	'series',
	'number',
	'note',
	'publisher',
	'location',
	'isbn',
	'pagetotal',
	END,
);

const IN_COLLECTION = biblatex(
	['author', 'title', 'booktitle'],
	EDITORS,
	CONTRIBUTORS,
	BOOK_CONTRIBUTORS,
	TITLE,
	MAIN_TITLE,
	BOOK_TITLE,
	LANGUAGE,
	'volume',
	'part',
	'edition',
	'volumes',
	'series',
	'number',
	'note',
	'publisher',
	'location',
	'isbn',
	PAGES,
	END,
);

const PROCEEDINGS = biblatex(
	['title'],
	'editor',
	TITLE,
	MAIN_TITLE,
	EVENT,
	'language',
	'volume',
	'part',
	'volumes',
	'series',
	'number',
	'note',
	'organization',
	'publisher',
	'location',
	'month',
	'isbn',
	PAGES,
	'pagetotal',
	END,
);

const IN_PROCEEDINGS = biblatex(
	['author', 'title', 'booktitle'],
	'editor',
	TITLE,
	MAIN_TITLE,
	BOOK_TITLE,
	EVENT,
	'language',
	'volume',
	'part',
	'volumes',
	'series',
	'number',
	'note',
	'organization',
	'publisher',
	'location',
	'month',
	'isbn',
	PAGES,
	END,
);

const REPORT = biblatex(
	['author', 'title', 'type', 'institution'],
	TITLE,
	'language',
	'number',
	'version',
	'note',
	'location',
	'month',
	'isrn',
	PAGES,
	'pagetotal',
	END,
);

const THESIS = biblatex(
	['author', 'title', 'type', 'institution'],
	TITLE,
	'language',
	'note',
	'location',
	'month',
	'isbn',
	PAGES,
	'pagetotal',
	END,
);

const MISC = biblatex(
	[['author', 'editor'], 'title'],
	TITLE,
	'language',
	'howpublished',
	'type',
	'version',
	'note',
	'organization',
	'location',
	'month',
	END,
);

export const BIBLATEX_TYPES: Record<string, EntryTypeSchema> = {
	article: biblatex(
		['author', 'title', 'journaltitle'],
		CONTRIBUTORS,
		EDITORS,
		TITLE,
		['journalsubtitle', 'journaltitleaddon'],
		['issuetitle', 'issuesubtitle', 'issuetitleaddon'],
		LANGUAGE,
		'series',
		'volume',
		'number',
		'eid',
		'issue',
		'month',
		'pages',
		'version',
		'note',
		'issn',
		END,
	),
	book: BOOK,
	mvbook: MV_BOOK,
	inbook: IN_BOOK,
	bookinbook: IN_BOOK,
	suppbook: IN_BOOK,
	booklet: biblatex(
		[['author', 'editor'], 'title'],
		TITLE,
		'language',
		'howpublished',
		'type',
		'note',
		'location',
		PAGES,
		'pagetotal',
		END,
	),
	collection: COLLECTION,
	mvcollection: MV_COLLECTION,
	incollection: IN_COLLECTION,
	suppcollection: IN_COLLECTION,
	dataset: biblatex(
		[['author', 'editor'], 'title'],
		TITLE,
		'language',
		'edition',
		'type',
		'series',
		'number',
		'version',
		'note',
		'organization',
		'publisher',
		'location',
		END,
	),
	manual: biblatex(
		[['author', 'editor'], 'title'],
		TITLE,
		'language',
		'edition',
		'type',
		'series',
		'number',
		'version',
		'note',
		'organization',
		'publisher',
		'location',
		'isbn',
		PAGES,
		'pagetotal',
		END,
	),
	misc: MISC,
	online: {
		required: [
			['author', 'editor'],
			'title',
			['date', 'year'],
			['doi', 'eprint', 'url'],
		],
		optional: [
			...TITLE,
			'language',
			'version',
			'note',
			'organization',
			'month',
			'addendum',
			'pubstate',
			'eprintclass',
			'eprinttype',
			'urldate',
		],
	},
	patent: biblatex(
		['author', 'title', 'number'],
		'holder',
		TITLE,
		'type',
		'version',
		'location',
		'note',
		'month',
		END,
	),
	periodical: biblatex(
		['editor', 'title'],
		['editora', 'editorb', 'editorc'],
		TITLE,
		['issuetitle', 'issuesubtitle', 'issuetitleaddon'],
		'language',
		'series',
		'volume',
		'number',
		'issue',
		'month',
		'note',
		'issn',
		END,
	),
	suppperiodical: biblatex(
		['author', 'title', 'journaltitle'],
		CONTRIBUTORS,
		EDITORS,
		TITLE,
		LANGUAGE,
		'series',
		'volume',
		'number',
		'issue',
		'month',
		'pages',
		'note',
		'issn',
		END,
	),
	proceedings: PROCEEDINGS,
	mvproceedings: PROCEEDINGS,
	inproceedings: IN_PROCEEDINGS,
	reference: COLLECTION,
	mvreference: MV_COLLECTION,
	inreference: IN_COLLECTION,
	report: REPORT,
	software: MISC,
	thesis: THESIS,
	unpublished: biblatex(
		['author', 'title'],
		TITLE,
		'type',
		EVENT,
		'language',
		'howpublished',
		'note',
		'location',
		'isbn',
		'month',
		'addendum',
		'pubstate',
		'url',
		'urldate',
	),
	set: { required: ['entryset'], optional: [] },
	xdata: { required: [], optional: [] },
};

// Types biblatex reads as others, the « type » they imply set for them.
export const BIBLATEX_TYPE_ALIASES: Record<string, string> = {
	conference: 'inproceedings',
	electronic: 'online',
	www: 'online',
	mastersthesis: 'thesis',
	phdthesis: 'thesis',
	techreport: 'report',
};

/** Fields biber reads as others: the old BibTeX names. */
export const BIBLATEX_FIELD_ALIASES: Record<string, string[]> = {
	journaltitle: ['journal'],
	location: ['address'],
	institution: ['school'],
	annotation: ['annote'],
	eprinttype: ['archiveprefix'],
	eprintclass: ['primaryclass'],
	sortkey: ['key'],
};

/** The types offered for a new entry or a change of type, in this order. */
export const ENTRY_TYPE_ORDER: Record<BibDialect, string[]> = {
	bibtex: [
		'article',
		'book',
		'inproceedings',
		'incollection',
		'inbook',
		'phdthesis',
		'mastersthesis',
		'techreport',
		'proceedings',
		'manual',
		'booklet',
		'unpublished',
		'misc',
	],
	biblatex: [
		'article',
		'book',
		'inproceedings',
		'incollection',
		'inbook',
		'thesis',
		'report',
		'online',
		'collection',
		'proceedings',
		'manual',
		'misc',
		'software',
		'dataset',
		'patent',
		'unpublished',
		'booklet',
		'periodical',
		'suppperiodical',
		'mvbook',
		'bookinbook',
		'suppbook',
		'mvcollection',
		'suppcollection',
		'mvproceedings',
		'reference',
		'mvreference',
		'inreference',
		'set',
		'xdata',
	],
};

export interface ResolvedSchema {
	/** The type the fields are those of (@phdthesis → thesis in biblatex). */
	baseType: string;
	known: boolean;
	required: RequiredSlot[];
	optional: string[];
	general: string[];
}

/** The fields of an entry type in a dialect; an unknown type takes those of
 * @misc, as BibTeX does. */
export function entryTypeSchema(
	type: string,
	dialect: BibDialect,
): ResolvedSchema {
	const lower = type.toLowerCase();
	if (dialect === 'bibtex') {
		const schema = BIBTEX_TYPES[lower];
		return {
			baseType: schema ? lower : 'misc',
			known: Boolean(schema),
			...(schema ?? BIBTEX_TYPES.misc),
			general: GENERAL_BIBTEX,
		};
	}
	const base = BIBLATEX_TYPE_ALIASES[lower] ?? lower;
	const schema = BIBLATEX_TYPES[base];
	const resolved = schema ?? BIBLATEX_TYPES.misc;
	// @phdthesis and the like set « type » themselves.
	const required =
		base !== lower
			? resolved.required.filter((slot) => slot !== 'type')
			: resolved.required;
	const optional =
		base !== lower && resolved.required.includes('type')
			? ['type', ...resolved.optional]
			: resolved.optional;
	return {
		baseType: schema ? base : 'misc',
		known: Boolean(schema),
		required,
		optional,
		general: GENERAL_BIBLATEX,
	};
}

/** The names a field is written under in a dialect: itself, then its
 * aliases (biblatex reads « journal » as « journaltitle »). */
export function fieldNames(field: string, dialect: BibDialect): string[] {
	return dialect === 'biblatex'
		? [field, ...(BIBLATEX_FIELD_ALIASES[field] ?? [])]
		: [field];
}

// Types and fields only biblatex knows, to tell a file's dialect.
const BIBLATEX_ONLY_TYPES = new Set(
	Object.keys(BIBLATEX_TYPES).filter((type) => !(type in BIBTEX_TYPES)),
);
const BIBLATEX_ONLY_FIELDS = new Set([
	'date',
	'journaltitle',
	'location',
	'eprinttype',
	'eprintclass',
	'langid',
	'subtitle',
	'titleaddon',
	'maintitle',
	'booksubtitle',
	'eventtitle',
	'eventdate',
	'venue',
	'origdate',
	'pubstate',
	'related',
	'xdata',
	'entryset',
	'shortjournal',
]);

/**
 * The dialect a file is written for: JabRef's mark if it has one, else
 * biblatex when the LaTeX files load it or the entries use its types or
 * fields, else BibTeX.
 */
export function detectDialect(
	entries: { type: string; fields: { name: string }[] }[],
	jabrefDialect: BibDialect | null,
	latexDialect: BibDialect | null,
): BibDialect {
	if (jabrefDialect) return jabrefDialect;
	if (latexDialect) return latexDialect;
	for (const entry of entries) {
		if (BIBLATEX_ONLY_TYPES.has(entry.type.toLowerCase())) return 'biblatex';
		if (
			entry.fields.some((field) =>
				BIBLATEX_ONLY_FIELDS.has(field.name.toLowerCase()),
			)
		) {
			return 'biblatex';
		}
	}
	return 'bibtex';
}

/** What LaTeX sources say of the bibliography: biblatex or BibTeX, if any. */
export function latexBibliographyDialect(sources: string[]): BibDialect | null {
	let bibtexSeen = false;
	for (const source of sources) {
		const text = source.replace(/(^|[^\\])%.*$/gm, '$1');
		if (
			/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b[^}]*\}|\\addbibresource/.test(
				text,
			)
		) {
			return 'biblatex';
		}
		if (/\\bibliographystyle\s*\{|\\bibliography\s*\{/.test(text)) {
			bibtexSeen = true;
		}
	}
	return bibtexSeen ? 'bibtex' : null;
}

/** Every field the types of a dialect name, to offer when adding one. */
export function validFieldNames(dialect: BibDialect): string[] {
	const types = dialect === 'bibtex' ? BIBTEX_TYPES : BIBLATEX_TYPES;
	const names = new Set<string>(
		dialect === 'bibtex' ? GENERAL_BIBTEX : GENERAL_BIBLATEX,
	);
	for (const schema of Object.values(types)) {
		for (const slot of schema.required) {
			for (const name of typeof slot === 'string' ? [slot] : slot)
				names.add(name);
		}
		for (const name of schema.optional) names.add(name);
	}
	return [...names].sort();
}
