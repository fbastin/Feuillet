// src/utils/bibDocument.ts
// A .bib file read as JabRef shows it, entry by entry and field by field,
// with where each piece is in the text: the entry editor changes only the
// characters a change concerns, as if they had been typed, so collaborators,
// the file's layout and its history keep everything else.

export type BibValueForm = 'braced' | 'quoted' | 'number' | 'expression';

export interface BibField {
	/** As written: « Title », « journal ». */
	name: string;
	nameFrom: number;
	nameTo: number;
	/** Where « = » is. */
	equals: number;
	/** The value as written, macros and « # » included. */
	valueFrom: number;
	valueTo: number;
	raw: string;
	/**
	 * What the entry editor shows: the inside of {…} or "…", the number, or
	 * the whole expression for a macro (« jan ») or a concatenation.
	 */
	value: string;
	form: BibValueForm;
	/** The comma after the value, if any. */
	comma: number | null;
}

export interface BibEntry {
	/** Where « @ » is and where the entry ends, past its closing brace. */
	from: number;
	to: number;
	/** As written: « article », « Article ». */
	type: string;
	typeFrom: number;
	typeTo: number;
	key: string;
	keyFrom: number;
	keyTo: number;
	/** The comma after the key, if any. */
	keyComma: number | null;
	/** Where the closing « } » or « ) » is, or null when it is missing. */
	close: number | null;
	fields: BibField[];
	/** Why the entry cannot be read to its end, if it cannot. */
	error?: string;
}

export interface BibParseError {
	at: number;
	message: string;
}

export interface BibDocument {
	entries: BibEntry[];
	/** @string macros: name in lower case → value as the editor shows it. */
	strings: Map<string, string>;
	/** The dialect JabRef records in an @comment of a file it saved. */
	jabrefDialect: 'bibtex' | 'biblatex' | null;
	errors: BibParseError[];
}

/** Messages, in English as translation keys. */
export const BIB_ERRORS = {
	unclosedEntry: 'The entry is not closed',
	missingEquals: 'A field name is not followed by =',
	missingValue: 'A field has no value',
	unclosedValue: 'A value is not closed',
	unexpected: 'Unexpected text in the entry',
} as const;

const isSpace = (char: string | undefined) =>
	char === ' ' || char === '\t' || char === '\n' || char === '\r';

// Field names, macros: what BibTeX does not use as punctuation.
const IDENTIFIER = /[^\s"#%'(),={}@]/;
const KEY_CHAR = /[^\s,{}()"]/;
// An entry starting a line, to go on after one left open.
const NEXT_ENTRY = /\n[ \t]*@[A-Za-z]+[ \t]*[{(]/g;

const lineStartOf = (text: string, pos: number): number =>
	text.lastIndexOf('\n', pos - 1) + 1;

/** Whether only spaces precede `pos` on its line. */
const startsLine = (text: string, pos: number): boolean =>
	/^[ \t]*$/.test(text.slice(lineStartOf(text, pos), pos));

class Reader {
	pos = 0;
	constructor(readonly text: string) {}

	skipSpace() {
		while (isSpace(this.text[this.pos])) this.pos++;
	}

	/** Spaces, and « % » comments to the end of their line, as biber reads
	 * them between the pieces of an entry. */
	skipGap() {
		for (;;) {
			this.skipSpace();
			if (this.text[this.pos] !== '%') return;
			const end = this.text.indexOf('\n', this.pos);
			this.pos = end < 0 ? this.text.length : end + 1;
		}
	}

	readWhile(pattern: RegExp): string {
		const start = this.pos;
		while (this.pos < this.text.length && pattern.test(this.text[this.pos])) {
			this.pos++;
		}
		return this.text.slice(start, this.pos);
	}

	/** Past the « } » closing the « { » at `pos`, braces counted as BibTeX
	 * counts them (a backslash does not escape one). */
	skipBraced(): boolean {
		let depth = 0;
		while (this.pos < this.text.length) {
			const char = this.text[this.pos++];
			if (char === '{') depth++;
			else if (char === '}') {
				depth--;
				if (depth === 0) return true;
			}
		}
		return false;
	}

	/** Past the quote closing the « " » at `pos`; quotes in braces do not. */
	skipQuoted(): boolean {
		let depth = 0;
		this.pos++;
		while (this.pos < this.text.length) {
			const char = this.text[this.pos++];
			if (char === '{') depth++;
			else if (char === '}') depth--;
			else if (char === '"' && depth <= 0) return true;
		}
		return false;
	}

	/** Past the « ) » closing the « ( » at `pos`, braces counted. */
	skipParenthesized(): boolean {
		let depth = 0;
		this.pos++;
		while (this.pos < this.text.length) {
			const char = this.text[this.pos++];
			if (char === '{') depth++;
			else if (char === '}') depth--;
			else if (char === ')' && depth <= 0) return true;
		}
		return false;
	}
}

type ValueResult =
	| { ok: true; from: number; to: number; value: string; form: BibValueForm }
	| { ok: false; error: string };

// A value: parts joined by « # ». The reader stops after the last part.
function readValue(reader: Reader): ValueResult {
	const text = reader.text;
	reader.skipGap();
	const from = reader.pos;
	let parts = 0;
	let end = from;
	let form: BibValueForm = 'expression';
	let value = '';

	for (;;) {
		const start = reader.pos;
		const char = text[start];
		if (char === '{' || char === '"') {
			const closed = char === '{' ? reader.skipBraced() : reader.skipQuoted();
			if (!closed) return { ok: false, error: BIB_ERRORS.unclosedValue };
			form = char === '{' ? 'braced' : 'quoted';
			value = text.slice(start + 1, reader.pos - 1);
		} else if (char !== undefined && /[0-9]/.test(char)) {
			reader.readWhile(/[0-9]/);
			form = 'number';
			value = text.slice(start, reader.pos);
		} else if (char !== undefined && IDENTIFIER.test(char)) {
			reader.readWhile(IDENTIFIER);
			form = 'expression';
			value = text.slice(start, reader.pos);
		} else {
			return { ok: false, error: BIB_ERRORS.missingValue };
		}
		parts++;
		end = reader.pos;
		reader.skipGap();
		if (text[reader.pos] === '#') {
			reader.pos++;
			reader.skipGap();
			continue;
		}
		reader.pos = end;
		break;
	}

	if (parts > 1) {
		form = 'expression';
		value = text.slice(from, end);
	}
	return { ok: true, from, to: end, value, form };
}

/** After an error: the next comma or closing delimiter at depth 0, or the
 * next entry starting a line. */
function recover(reader: Reader, closing: string): void {
	const text = reader.text;
	let depth = 0;
	while (reader.pos < text.length) {
		const char = text[reader.pos];
		if (char === '@' && depth === 0 && startsLine(text, reader.pos)) return;
		if (char === '{') depth++;
		else if (char === '}') {
			if (depth === 0) {
				if (closing === '}') return;
			} else depth--;
		} else if (depth === 0 && (char === ',' || char === closing)) return;
		reader.pos++;
	}
}

/** Reads a .bib file. It never throws: what it cannot read is in `errors`. */
export function parseBibDocument(text: string): BibDocument {
	const reader = new Reader(text);
	const entries: BibEntry[] = [];
	const strings = new Map<string, string>();
	const errors: BibParseError[] = [];
	let jabrefDialect: BibDocument['jabrefDialect'] = null;

	while (reader.pos < text.length) {
		// BibTeX ignores what is outside entries.
		const at = text.indexOf('@', reader.pos);
		if (at < 0) break;
		reader.pos = at + 1;
		// « %@article{… »: an entry put aside, as biber and JabRef read it.
		if (text.slice(lineStartOf(text, at), at).includes('%')) continue;
		reader.skipSpace();
		const typeFrom = reader.pos;
		const type = reader.readWhile(/[A-Za-z0-9_\-:]/);
		const typeTo = reader.pos;
		if (!type) continue;
		reader.skipSpace();
		const openChar = text[reader.pos];
		if (openChar !== '{' && openChar !== '(') continue;
		const closing = openChar === '{' ? '}' : ')';
		const lowerType = type.toLowerCase();

		if (lowerType === 'comment' || lowerType === 'preamble') {
			const blockStart = reader.pos;
			const closed =
				openChar === '{' ? reader.skipBraced() : reader.skipParenthesized();
			if (!closed) {
				reader.pos = blockStart + 1;
				continue;
			}
			const dialect =
				lowerType === 'comment'
					? /jabref-meta:\s*databaseType:\s*(bibtex|biblatex)/i.exec(
							text.slice(blockStart, reader.pos),
						)?.[1]
					: undefined;
			if (dialect) {
				jabrefDialect = dialect.toLowerCase() as 'bibtex' | 'biblatex';
			}
			continue;
		}

		reader.pos++;

		if (lowerType === 'string') {
			reader.skipSpace();
			const name = reader.readWhile(IDENTIFIER);
			reader.skipSpace();
			if (name && text[reader.pos] === '=') {
				reader.pos++;
				const value = readValue(reader);
				if (value.ok) strings.set(name.toLowerCase(), value.value);
			}
			recover(reader, closing);
			if (text[reader.pos] === closing) reader.pos++;
			continue;
		}

		const entry: BibEntry = {
			from: at,
			to: text.length,
			type,
			typeFrom,
			typeTo,
			key: '',
			keyFrom: reader.pos,
			keyTo: reader.pos,
			keyComma: null,
			close: null,
			fields: [],
		};
		entries.push(entry);

		reader.skipSpace();
		entry.keyFrom = reader.pos;
		entry.key = reader.readWhile(KEY_CHAR);
		entry.keyTo = reader.pos;
		reader.skipGap();
		if (text[reader.pos] === ',') {
			entry.keyComma = reader.pos;
			reader.pos++;
		}

		const fail = (message: string, position: number) => {
			entry.error = entry.error ?? message;
			errors.push({ at: position, message });
		};

		for (;;) {
			reader.skipGap();
			const char = text[reader.pos];
			if (char === closing) {
				entry.close = reader.pos;
				reader.pos++;
				entry.to = reader.pos;
				break;
			}
			// The text ends, or the next entry starts: this one is left open.
			if (char === undefined || char === '@') {
				fail(BIB_ERRORS.unclosedEntry, entry.from);
				entry.to = reader.pos;
				break;
			}
			if (char === ',') {
				reader.pos++;
				continue;
			}
			const nameFrom = reader.pos;
			const name = reader.readWhile(IDENTIFIER);
			const nameTo = reader.pos;
			if (!name) {
				fail(BIB_ERRORS.unexpected, reader.pos);
				reader.pos++;
				recover(reader, closing);
				continue;
			}
			reader.skipGap();
			if (text[reader.pos] !== '=') {
				fail(BIB_ERRORS.missingEquals, nameFrom);
				recover(reader, closing);
				continue;
			}
			const equals = reader.pos;
			reader.pos++;
			const valueStart = reader.pos;
			const value = readValue(reader);
			if (!value.ok) {
				fail(value.error, nameFrom);
				if (value.error === BIB_ERRORS.unclosedValue) {
					// An open brace swallows the rest: go on at the next entry
					// starting a line, if there is one.
					NEXT_ENTRY.lastIndex = valueStart;
					const next = NEXT_ENTRY.exec(text);
					reader.pos = next ? next.index + 1 : text.length;
					entry.to = reader.pos;
					break;
				}
				recover(reader, closing);
				continue;
			}
			const field: BibField = {
				name,
				nameFrom,
				nameTo,
				equals,
				valueFrom: value.from,
				valueTo: value.to,
				raw: text.slice(value.from, value.to),
				value: value.value,
				form: value.form,
				comma: null,
			};
			entry.fields.push(field);
			reader.skipGap();
			const after = text[reader.pos];
			if (after === ',') {
				field.comma = reader.pos;
				reader.pos++;
			} else if (after !== closing && after !== '@' && after !== undefined) {
				fail(BIB_ERRORS.unexpected, reader.pos);
				recover(reader, closing);
			}
		}
	}

	return { entries, strings, jabrefDialect, errors };
}

/** The field of an entry, whatever the case it is written in. */
export function findField(entry: BibEntry, name: string): BibField | undefined {
	const lower = name.toLowerCase();
	return entry.fields.find((field) => field.name.toLowerCase() === lower);
}

/** A field's value, macros of @string replaced, for reading only. */
export function fieldText(
	document: BibDocument,
	field: BibField | undefined,
): string {
	if (!field) return '';
	if (field.form !== 'expression') return field.value;
	return field.raw
		.split(/\s*#\s*/)
		.map((part) => {
			if (/^\{[\s\S]*\}$|^"[\s\S]*"$/.test(part)) return part.slice(1, -1);
			return document.strings.get(part.toLowerCase()) ?? part;
		})
		.join('');
}

// ---------------------------------------------------------------------------
// Changes: each is the smallest replacement in the text.

export interface BibChange {
	from: number;
	to: number;
	insert: string;
}

/** A change refused; its message is an English translation key. */
export class BibEditError extends Error {}

export const BIB_EDIT_ERRORS = {
	unbalanced: 'The braces are not balanced',
	invalidExpression: 'This is not a BibTeX value',
	invalidKey: 'A key cannot contain spaces, commas, braces or quotes',
	emptyKey: 'The key cannot be empty',
	invalidType: 'An entry type is made of letters',
	invalidFieldName:
		'A field name starts with a letter, then letters, digits or - _ . :',
	brokenEntry: 'This entry cannot be read to its end: fix it in the text',
} as const;

/** Whether braces balance, as BibTeX counts them. */
export function bracesBalance(text: string): boolean {
	let depth = 0;
	for (const char of text) {
		if (char === '{') depth++;
		else if (char === '}') {
			depth--;
			if (depth < 0) return false;
		}
	}
	return depth === 0;
}

// A double quote outside braces would end a "…" value.
const hasBareQuote = (text: string): boolean => {
	let depth = 0;
	for (const char of text) {
		if (char === '{') depth++;
		else if (char === '}') depth--;
		else if (char === '"' && depth === 0) return true;
	}
	return false;
};

/** The value as written in the file, in the form it had if it can keep it. */
export function formatBibValue(value: string, form: BibValueForm): string {
	if (form === 'expression') {
		const reader = new Reader(value);
		const result = readValue(reader);
		reader.skipSpace();
		if (!result.ok || reader.pos !== value.length) {
			throw new BibEditError(BIB_EDIT_ERRORS.invalidExpression);
		}
		return value.trim();
	}
	if (!bracesBalance(value)) throw new BibEditError(BIB_EDIT_ERRORS.unbalanced);
	if (form === 'number' && /^[0-9]+$/.test(value)) return value;
	if (form === 'quoted' && !hasBareQuote(value)) return `"${value}"`;
	return `{${value}}`;
}

/** Past the spaces after `pos` and the line break ending its line, when
 * only spaces follow `pos` on it. */
const pastLineEnd = (text: string, pos: number): number => {
	const match = /^[ \t]*\r?\n/.exec(text.slice(pos, pos + 200));
	if (match) return pos + match[0].length;
	// The last line of the text.
	return /^[ \t]*$/.test(text.slice(pos)) ? text.length : pos;
};

function assertReadable(entry: BibEntry): void {
	if (entry.error || entry.close === null) {
		throw new BibEditError(BIB_EDIT_ERRORS.brokenEntry);
	}
}

/** How the entry's fields are written, to write a new one like them. */
function fieldLayout(text: string, entry: BibEntry) {
	const own = entry.fields.filter((field) => startsLine(text, field.nameFrom));
	const first = own[0] ?? entry.fields[0];
	const indent = own[0]
		? text.slice(lineStartOf(text, own[0].nameFrom), own[0].nameFrom)
		: '  ';
	const spaces = (from: number, to: number, fallback: string) =>
		first ? text.slice(from, to).replace(/[^ \t]/g, '') : fallback;
	// Aligned « = », as bibtex-tidy writes them.
	const columns = own.map(
		(field) => field.equals - lineStartOf(text, field.nameFrom),
	);
	const aligned =
		own.length > 1 &&
		columns.every((column) => column === columns[0]) &&
		own.some((field) => field.name.length !== own[0].name.length)
			? columns[0]
			: null;
	return {
		indent: indent || '  ',
		before: first ? spaces(first.nameTo, first.equals, ' ') : ' ',
		after: first ? spaces(first.equals + 1, first.valueFrom, ' ') : ' ',
		aligned,
		trailingComma:
			entry.fields.length > 0 &&
			entry.fields.every((field) => field.comma !== null),
		inline: entry.fields.length > 0 && own.length === 0,
	};
}

/** The changes giving the field `name` the value `value`: added when the
 * entry does not have it, removed when the value is empty. */
export function setFieldChanges(
	text: string,
	entry: BibEntry,
	name: string,
	value: string,
	form?: BibValueForm,
): BibChange[] {
	assertReadable(entry);
	const field = findField(entry, name);
	if (field) {
		if (value.trim() === '') return deleteFieldChanges(text, entry, field.name);
		const insert = formatBibValue(value, form ?? field.form);
		if (insert === field.raw) return [];
		return [{ from: field.valueFrom, to: field.valueTo, insert }];
	}
	if (value.trim() === '') return [];
	if (!/^[A-Za-z][\w\-.:]*$/.test(name)) {
		throw new BibEditError(BIB_EDIT_ERRORS.invalidFieldName);
	}
	const written = formatBibValue(value, form ?? 'braced');
	const layout = fieldLayout(text, entry);
	const nameColumn = layout.indent.length + name.length;
	const before =
		layout.aligned !== null
			? ' '.repeat(Math.max(1, layout.aligned - nameColumn))
			: layout.before;
	const line = `${name}${before}=${layout.after}${written}`;
	const last = entry.fields[entry.fields.length - 1];

	if (last && layout.inline) {
		return last.comma !== null
			? [{ from: last.comma + 1, to: last.comma + 1, insert: ` ${line},` }]
			: [{ from: last.valueTo, to: last.valueTo, insert: `, ${line}` }];
	}
	if (last) {
		return last.comma !== null
			? [
					{
						from: last.comma + 1,
						to: last.comma + 1,
						insert: `\n${layout.indent}${line}${layout.trailingComma ? ',' : ''}`,
					},
				]
			: [
					{
						from: last.valueTo,
						to: last.valueTo,
						insert: `,\n${layout.indent}${line}`,
					},
				];
	}

	// The entry's first field.
	const anchor = entry.keyComma !== null ? entry.keyComma + 1 : entry.keyTo;
	const comma = entry.keyComma !== null ? '' : ',';
	const close = entry.close as number;
	if (text.slice(anchor, close).includes('\n')) {
		return [
			{ from: anchor, to: anchor, insert: `${comma}\n${layout.indent}${line}` },
		];
	}
	return [
		{ from: anchor, to: close, insert: `${comma}\n${layout.indent}${line}\n` },
	];
}

/** The changes removing a field, and its line when it has one of its own. */
export function deleteFieldChanges(
	text: string,
	entry: BibEntry,
	name: string,
): BibChange[] {
	assertReadable(entry);
	const field = findField(entry, name);
	if (!field) return [];
	const end = field.comma !== null ? field.comma + 1 : field.valueTo;
	if (startsLine(text, field.nameFrom)) {
		const lineEnd = pastLineEnd(text, end);
		if (lineEnd !== end) {
			return [
				{ from: lineStartOf(text, field.nameFrom), to: lineEnd, insert: '' },
			];
		}
	}
	const index = entry.fields.indexOf(field);
	if (field.comma === null && index > 0) {
		// The last field on a line with others: the comma before it goes too.
		const previous = entry.fields[index - 1];
		if (previous.comma !== null) {
			return [{ from: previous.comma, to: field.valueTo, insert: '' }];
		}
	}
	const spaces = /^[ \t]*/.exec(text.slice(end))?.[0].length ?? 0;
	return [{ from: field.nameFrom, to: end + spaces, insert: '' }];
}

/** Refuses what BibTeX and biber stop a key at. */
export function checkKey(key: string): void {
	if (!key.trim()) throw new BibEditError(BIB_EDIT_ERRORS.emptyKey);
	if (!/^[^\s,{}()"#%'=\\]+$/.test(key)) {
		throw new BibEditError(BIB_EDIT_ERRORS.invalidKey);
	}
}

export function renameKeyChanges(entry: BibEntry, key: string): BibChange[] {
	assertReadable(entry);
	checkKey(key);
	if (key === entry.key) return [];
	return [{ from: entry.keyFrom, to: entry.keyTo, insert: key }];
}

/** The new type, in the case the entry's was written in (« Article »). */
export function changeTypeChanges(entry: BibEntry, type: string): BibChange[] {
	assertReadable(entry);
	if (!/^[A-Za-z]+$/.test(type)) {
		throw new BibEditError(BIB_EDIT_ERRORS.invalidType);
	}
	let written = type.toLowerCase();
	if (entry.type.length > 1 && entry.type === entry.type.toUpperCase()) {
		written = written.toUpperCase();
	} else if (/^[A-Z]/.test(entry.type)) {
		written = written[0].toUpperCase() + written.slice(1);
	}
	if (written === entry.type) return [];
	return [{ from: entry.typeFrom, to: entry.typeTo, insert: written }];
}

/** Removes an entry, and the blank lines that kept it apart. */
export function deleteEntryChanges(text: string, entry: BibEntry): BibChange[] {
	const from = startsLine(text, entry.from)
		? lineStartOf(text, entry.from)
		: entry.from;
	let to = pastLineEnd(text, entry.to);
	let start = from;
	if (
		from === 0 ||
		/\n[ \t]*\r?\n$/.test(text.slice(Math.max(0, from - 200), from))
	) {
		for (;;) {
			const next = pastLineEnd(text, to);
			if (next === to) break;
			to = next;
		}
	}
	// The last entry: the blank lines before it go too.
	if (text.slice(to).trim() === '' && start > 0) {
		const before = text.slice(0, start);
		const kept = before.replace(/(\r?\n[ \t]*)+$/, '');
		if (kept.length < before.length) {
			// The line before keeps its own line end.
			start = kept.length
				? kept.length + (before.startsWith('\r\n', kept.length) ? 2 : 1)
				: 0;
			to = text.length;
		}
	}
	return [{ from: start, to, insert: '' }];
}

/** Adds an entry at the end of the file, a blank line before it. */
export function addEntryChanges(
	text: string,
	type: string,
	key: string,
): BibChange[] {
	checkKey(key);
	if (!/^[A-Za-z]+$/.test(type)) {
		throw new BibEditError(BIB_EDIT_ERRORS.invalidType);
	}
	return appendEntryChanges(text, `@${type.toLowerCase()}{${key},\n}`);
}

/** Adds an entry written out (an import's) at the end of the file. */
export function appendEntryChanges(text: string, entry: string): BibChange[] {
	const end = text.replace(/\s+$/, '').length;
	return [
		{
			from: end,
			to: text.length,
			insert: `${end ? '\n\n' : ''}${entry.trim()}\n`,
		},
	];
}

/** The text once `changes`, which do not overlap, are made. */
export function applyBibChanges(text: string, changes: BibChange[]): string {
	let result = text;
	for (const change of [...changes].sort((a, b) => b.from - a.from)) {
		result =
			result.slice(0, change.from) + change.insert + result.slice(change.to);
	}
	return result;
}

/** How a file's entries are written, from its last one with fields on
 * lines of their own; two spaces, « = » between spaces, otherwise. */
export interface EntryLayout {
	indent: string;
	before: string;
	after: string;
	/** « = » aligned, as bibtex-tidy and JabRef write them. */
	aligned: boolean;
	trailingComma: boolean;
}

export function documentLayout(text: string): EntryLayout {
	const entries = parseBibDocument(text).entries;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.error || entry.fields.length < 2) continue;
		const layout = fieldLayout(text, entry);
		if (layout.inline) continue;
		return {
			indent: layout.indent,
			before: layout.before,
			after: layout.after,
			aligned: layout.aligned !== null,
			trailingComma: layout.trailingComma,
		};
	}
	return {
		indent: '  ',
		before: ' ',
		after: ' ',
		aligned: false,
		trailingComma: false,
	};
}

/** A new entry written out: values braced, but macros (a month in BibTeX)
 * and @string names given as `bare`. */
export function writeEntry(
	type: string,
	key: string,
	fields: [string, string][],
	layout: EntryLayout,
	bare: (name: string, value: string) => boolean = () => false,
): string {
	checkKey(key);
	const width = Math.max(0, ...fields.map(([name]) => name.length));
	const lines = fields.map(([name, value], index) => {
		const before = layout.aligned
			? ' '.repeat(width - name.length + 1)
			: layout.before;
		const written = bare(name, value) ? value : formatBibValue(value, 'braced');
		const comma = index < fields.length - 1 || layout.trailingComma ? ',' : '';
		return `${layout.indent}${name}${before}=${layout.after}${written}${comma}`;
	});
	return `@${type}{${key},\n${lines.join('\n')}\n}`;
}
