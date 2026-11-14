// src/utils/bibDuplicates.ts
// Entries of a .bib that are probably the same work, as JabRef's « Find
// duplicates »: the same key, DOI, arXiv number or (between books) ISBN, or
// the same title, first author and year, a typo apart; and the merge of two
// of them, field by field, into the one whose key is kept.
import {
	applyBibChanges,
	type BibChange,
	type BibDocument,
	type BibEntry,
	type BibField,
	changeTypeChanges,
	deleteEntryChanges,
	fieldText,
	findField,
	parseBibDocument,
	setFieldChanges,
} from './bibDocument';
import { BIBLATEX_FIELD_ALIASES } from './bibEntryTypes';
import { isbn13 } from './bibIdentifiers';
import { splitNames } from './bibPreview';
import { plainText } from './referenceSearch';

export type DuplicateReason = 'key' | 'doi' | 'arxiv' | 'isbn' | 'title';

/** Two entries, by their index in the file (a < b), and why. */
export interface DuplicatePair {
	a: number;
	b: number;
	reason: DuplicateReason;
}

// The strongest reason first, when several hold.
const STRENGTH: Record<DuplicateReason, number> = {
	key: 5,
	doi: 4,
	arxiv: 3,
	isbn: 2,
	title: 1,
};

// Types that are a whole book: their ISBN is theirs alone (a chapter has
// its book's).
const BOOK_TYPES = new Set([
	'book',
	'mvbook',
	'collection',
	'mvcollection',
	'proceedings',
	'mvproceedings',
	'reference',
	'mvreference',
	'manual',
]);

const ARXIV_ID = /(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/;

export const normalDoi = (value: string): string =>
	value
		.trim()
		.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
		.replace(/^doi:\s*/i, '')
		.toLowerCase();

/** A title as compared: no accents, LaTeX, case or punctuation. */
export const normalTitle = (title: string): string =>
	plainText(title)
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/** The family name of the first author (or editor), as compared. */
function firstFamily(names: string): string {
	const first = splitNames(names)[0];
	if (!first || first.toLowerCase() === 'others') return '';
	let depth = 0;
	for (let i = 0; i < first.length; i++) {
		if (first[i] === '{') depth++;
		else if (first[i] === '}') depth--;
		else if (first[i] === ',' && depth === 0) {
			return normalTitle(first.slice(0, i)).replace(/ /g, '');
		}
	}
	// « First von Last »: the last word, or the braced name.
	const words = normalTitle(first).split(' ');
	return first.trim().startsWith('{') && first.trim().endsWith('}')
		? words.join('')
		: (words[words.length - 1] ?? '');
}

/** Edit distance, two rows. */
function distance(a: string, b: string): number {
	if (a === b) return 0;
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	let current = new Array<number>(b.length + 1);
	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		[previous, current] = [current, previous];
	}
	return previous[b.length];
}

/** The same title, a typo or two apart. */
export function similarTitles(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	const longest = Math.max(a.length, b.length);
	if (longest < 20 || Math.abs(a.length - b.length) > longest * 0.1) {
		return false;
	}
	return distance(a, b) <= longest * 0.08;
}

interface Identity {
	key: string;
	doi: string;
	arxiv: string;
	isbn: string;
	title: string;
	family: string;
	year: string;
}

function identityOf(document: BibDocument, entry: BibEntry): Identity {
	const value = (...names: string[]) => {
		for (const name of names) {
			const text = fieldText(document, findField(entry, name)).trim();
			if (text) return text;
		}
		return '';
	};
	const doi = normalDoi(value('doi'));
	let arxiv = '';
	const eprint = value('eprint');
	const archive = value('archiveprefix', 'eprinttype').toLowerCase();
	if (eprint && (archive === 'arxiv' || !archive)) {
		arxiv = ARXIV_ID.exec(eprint)?.[1] ?? '';
	}
	if (!arxiv && /^10\.48550\/arxiv\./.test(doi)) {
		arxiv = doi.slice('10.48550/arxiv.'.length).replace(/v\d+$/, '');
	}
	if (!arxiv) {
		// arxiv.org/abs/…, « arXiv preprint arXiv:1706.03762 ».
		const written = [
			value('url'),
			value('journal', 'journaltitle'),
			value('note'),
			value('howpublished'),
		].join(' ');
		arxiv =
			/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i
				.exec(written)?.[1]
				?.replace(/v\d+$/, '')
				.replace(/\.pdf$/, '') ??
			new RegExp(`arxiv:?\\s*${ARXIV_ID.source}`, 'i').exec(written)?.[1] ??
			'';
	}
	let isbn = '';
	if (BOOK_TYPES.has(entry.type.toLowerCase())) {
		const written = value('isbn').replace(/[\s-]/g, '').toUpperCase();
		if (/^(\d{9}[\dX]|\d{13})$/.test(written)) isbn = isbn13(written);
	}
	return {
		key: entry.key.toLowerCase(),
		doi,
		arxiv: arxiv.toLowerCase(),
		isbn,
		title: normalTitle(value('title')),
		family: firstFamily(value('author', 'editor')),
		year: value('year') || (/^\d{4}/.exec(value('date'))?.[0] ?? ''),
	};
}

/**
 * The pairs of entries that are probably the same work. Two entries with
 * the same identifier but titles that differ (a chapter given its book's
 * DOI) are not.
 */
export function findDuplicates(document: BibDocument): DuplicatePair[] {
	const entries = document.entries;
	const identities = entries.map((entry) => identityOf(document, entry));
	const pairs = new Map<string, DuplicatePair>();
	const add = (a: number, b: number, reason: DuplicateReason) => {
		if (a === b) return;
		const [low, high] = a < b ? [a, b] : [b, a];
		const id = `${low}:${high}`;
		const known = pairs.get(id);
		if (!known || STRENGTH[reason] > STRENGTH[known.reason]) {
			pairs.set(id, { a: low, b: high, reason });
		}
	};
	const titlesAgree = (a: Identity, b: Identity) =>
		!a.title || !b.title || similarTitles(a.title, b.title);

	// Equal values of one identifier.
	const byValue = (
		reason: DuplicateReason,
		pick: (identity: Identity) => string,
		check: (a: Identity, b: Identity) => boolean = () => true,
	) => {
		const seen = new Map<string, number[]>();
		identities.forEach((identity, index) => {
			const value = pick(identity);
			if (!value) return;
			const others = seen.get(value);
			if (others) {
				for (const other of others) {
					if (check(identities[other], identity)) add(other, index, reason);
				}
				others.push(index);
			} else {
				seen.set(value, [index]);
			}
		});
	};
	byValue('key', (identity) => identity.key);
	byValue('doi', (identity) => identity.doi, titlesAgree);
	byValue('arxiv', (identity) => identity.arxiv, titlesAgree);
	byValue('isbn', (identity) => identity.isbn, titlesAgree);

	// The same title, first author and year, where both are written.
	const agree = (a: Identity, b: Identity) =>
		(!a.family || !b.family || a.family === b.family) &&
		(!a.year || !b.year || a.year === b.year);
	byValue('title', (identity) => identity.title, agree);
	// A typo apart: within the same first author and year.
	const buckets = new Map<string, number[]>();
	identities.forEach((identity, index) => {
		if (!identity.title || !identity.family || !identity.year) return;
		const bucket = `${identity.family}|${identity.year}`;
		const others = buckets.get(bucket);
		if (others) {
			for (const other of others) {
				const title = identities[other].title;
				if (title !== identity.title && similarTitles(title, identity.title)) {
					add(other, index, 'title');
				}
			}
			others.push(index);
		} else {
			buckets.set(bucket, [index]);
		}
	});

	return [...pairs.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}

// ---------------------------------------------------------------------------
// Merging

/** One field of the merge: what each entry has. */
export interface MergeRow {
	/** The name compared (biblatex's for an alias: journaltitle). */
	name: string;
	fields: [BibField | undefined, BibField | undefined];
	/** Both say the same, or only one has it. */
	agree: boolean;
}

const ALIAS_OF = new Map<string, string>(
	Object.entries(BIBLATEX_FIELD_ALIASES).flatMap(([name, aliases]) =>
		aliases.map((alias) => [alias, name] as [string, string]),
	),
);
const canonical = (name: string) => {
	const lower = name.toLowerCase();
	// « key » is BibTeX's sort key, biblatex's sortkey: not merged as one.
	return lower === 'key' ? lower : (ALIAS_OF.get(lower) ?? lower);
};
const sameValue = (a: BibField, b: BibField) =>
	a.value.replace(/\s+/g, ' ').trim() === b.value.replace(/\s+/g, ' ').trim();

/** The fields of two entries side by side, the first one's order first. */
export function mergeRows(first: BibEntry, second: BibEntry): MergeRow[] {
	const rows = new Map<string, MergeRow>();
	const place = (field: BibField, side: 0 | 1) => {
		const name = canonical(field.name);
		let row = rows.get(name);
		if (!row) {
			row = { name, fields: [undefined, undefined], agree: true };
			rows.set(name, row);
		}
		// A field written twice: its first value, as BibTeX reads it.
		if (!row.fields[side]) row.fields[side] = field;
	};
	for (const field of first.fields) place(field, 0);
	for (const field of second.fields) place(field, 1);
	for (const row of rows.values()) {
		const [a, b] = row.fields;
		row.agree = !a || !b || sameValue(a, b);
	}
	return [...rows.values()];
}

/**
 * The changes merging `other` into `kept`: `kept` takes the type and, for
 * each row, the value of the side chosen (a field only `other` has is
 * added), written as `kept` writes its fields; `other` is deleted. Only the
 * fields that change are rewritten in `kept`.
 */
export function mergeChanges(
	text: string,
	kept: BibEntry,
	other: BibEntry,
	choice: {
		type: string;
		/** The row names whose value comes from `other`. */
		fromOther: Set<string>;
	},
): BibChange[] {
	let written = text.slice(kept.from, kept.to);
	const entryOf = (source: string) => {
		const entry = parseBibDocument(source).entries[0];
		if (!entry) throw new Error('The entry could not be read');
		return entry;
	};
	if (choice.type.toLowerCase() !== kept.type.toLowerCase()) {
		written = applyBibChanges(
			written,
			changeTypeChanges(entryOf(written), choice.type),
		);
	}
	// A field added is named as the kept entry names its own: Title or title.
	const capitalized =
		kept.fields.length > 0 &&
		kept.fields.filter((field) => /^[A-Z]/.test(field.name)).length * 2 >
			kept.fields.length;
	const nameAdded = (name: string) =>
		capitalized
			? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
			: name.toLowerCase();
	for (const row of mergeRows(kept, other)) {
		const [own, theirs] = row.fields;
		if (!theirs) continue;
		if (own && !choice.fromOther.has(row.name)) continue;
		if (own && sameValue(own, theirs) && own.form === theirs.form) continue;
		const entry = entryOf(written);
		written = applyBibChanges(
			written,
			setFieldChanges(
				written,
				entry,
				own?.name ?? nameAdded(theirs.name),
				theirs.value,
				theirs.form,
			),
		);
	}

	// Only what differs in the kept entry, to leave others' cursors there.
	const before = text.slice(kept.from, kept.to);
	let start = 0;
	while (
		start < before.length &&
		start < written.length &&
		before[start] === written[start]
	) {
		start++;
	}
	let end = 0;
	while (
		end < before.length - start &&
		end < written.length - start &&
		before[before.length - 1 - end] === written[written.length - 1 - end]
	) {
		end++;
	}
	const changes: BibChange[] = [];
	if (start < before.length - end || start < written.length - end) {
		changes.push({
			from: kept.from + start,
			to: kept.to - end,
			insert: written.slice(start, written.length - end),
		});
	}
	return [...changes, ...deleteEntryChanges(text, other)];
}

/** The entry with this key nearest to where it was, or -1. */
export function findEntryIndex(
	entries: BibEntry[],
	key: string,
	near: number,
): number {
	let best = -1;
	entries.forEach((entry, index) => {
		if (
			entry.key === key &&
			(best < 0 || Math.abs(index - near) < Math.abs(best - near))
		) {
			best = index;
		}
	});
	return best;
}
