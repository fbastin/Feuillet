// extras/viewers/bibtex/BibEntriesView.tsx
// The entries of a .bib file as JabRef shows them: a list to search and
// sort, the chosen entry's fields as a form (those its type requires, then
// the optional ones, in BibTeX's or biblatex's sense) and its preview. Each
// change is the smallest edit of the text, made through the collaborative
// editor as if typed.
import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
	AlertCircleIcon,
	CheckIcon,
	FileTextIcon,
	PlusIcon,
	SearchIcon,
	TrashIcon,
} from '@/components/common/Icons';
import { BIBTEX_FIELD_DOCS } from '@/extensions/codemirror/languageDocs/bibtexDocsData';
import { t } from '@/i18n';
import {
	type BibChange,
	type BibDocument,
	type BibEntry,
	type BibField,
	changeTypeChanges,
	checkKey,
	deleteEntryChanges,
	deleteFieldChanges,
	fieldText,
	findField,
	parseBibDocument,
	renameKeyChanges,
	setFieldChanges,
} from '@/utils/bibDocument';
import {
	type BibDialect,
	detectDialect,
	ENTRY_TYPE_ORDER,
	entryTypeSchema,
	fieldNames,
	type RequiredSlot,
	validFieldNames,
} from '@/utils/bibEntryTypes';
import { parseIdentifier } from '@/utils/bibIdentifiers';
import { previewEntry } from '@/utils/bibPreview';
import type { CitedKey, ProjectCitations } from '@/utils/latexCitations';
import { authorsLabel, displayText, plainText } from '@/utils/referenceSearch';
import { BibPreview, editErrorMessage } from './BibPreview';
import { NewEntryPanel } from './NewEntryPanel';
import type { CitationRename } from './useProjectCitations';
import './entries.css';

/** Makes the changes from the text as it is when they are made. */
export type BibEdit = (text: string) => BibChange[];

interface BibEntriesViewProps {
	text: string;
	/** Shown: the text is read only then, not while the text view is. */
	active: boolean;
	readOnly: boolean;
	/** The dialect chosen for this file, or null to go by the one found. */
	chosenDialect: BibDialect | null;
	/** What the project's LaTeX files load: biblatex or BibTeX, if known. */
	latexDialect: BibDialect | null;
	onDialectChange: (dialect: BibDialect | null) => void;
	/** Makes an edit; throws a BibEditError when it is refused. */
	onEdit: (edit: BibEdit) => void;
	onShowInText: (from: number, to: number) => void;
	/** Where the text editor's cursor was, to open on the entry there. */
	cursor?: { at: number } | null;
	/** What the project's LaTeX files cite, once read. */
	citations?: ProjectCitations | null;
	/** Writes `to` where `from` is cited in the LaTeX files. */
	onRenameCitations?: (from: string, to: string) => Promise<CitationRename>;
}

interface Selection {
	key: string;
	index: number;
}

type SortKey =
	| 'type'
	| 'key'
	| 'authors'
	| 'title'
	| 'year'
	| 'container'
	| 'cited';

type CitedFilter = 'all' | 'cited' | 'uncited';

/** A rename of a key's citations, told under the entry renamed. */
interface CitationRenameState {
	from: string;
	to: string;
	status: 'busy' | 'done' | 'error';
	result?: CitationRename;
	message?: string;
}

interface Row {
	index: number;
	entry: BibEntry;
	type: string;
	authors: string;
	title: string;
	year: string;
	container: string;
	search: string;
	problems: string[];
	/** Citations in the LaTeX files. */
	cited: number;
}

const LONG_FIELDS = new Set([
	'abstract',
	'annotation',
	'annote',
	'note',
	'addendum',
	'comment',
	'file',
]);

const PLACEHOLDERS: Record<string, () => string> = {
	author: () => t('Last, First and Last, First'),
	editor: () => t('Last, First and Last, First'),
	year: () => t('YYYY'),
	date: () => t('YYYY-MM-DD'),
	pages: () => '12--34',
	doi: () => '10.1000/xyz123',
	url: () => 'https://',
	urldate: () => t('YYYY-MM-DD'),
};

const SHOW_EMPTY_KEY = 'feuillet-bib-show-empty-fields';

const readShowEmpty = (): boolean => {
	try {
		return localStorage.getItem(SHOW_EMPTY_KEY) === 'true';
	} catch {
		return false;
	}
};

/** The entry a selection points at, after the text changed. */
function resolveEntry(
	entries: BibEntry[],
	selection: Selection | null,
): number {
	if (!selection || entries.length === 0) return -1;
	let best = -1;
	for (let i = 0; i < entries.length; i++) {
		if (entries[i].key !== selection.key) continue;
		if (
			best < 0 ||
			Math.abs(i - selection.index) < Math.abs(best - selection.index)
		) {
			best = i;
		}
	}
	if (best >= 0) return best;
	return Math.min(selection.index, entries.length - 1);
}

const fieldDescription = (name: string): string | undefined =>
	BIBTEX_FIELD_DOCS[name.toLowerCase()]?.().description;

/** The field a slot is written under in the entry: itself or an alias. */
function slotField(
	entry: BibEntry,
	name: string,
	dialect: BibDialect,
): BibField | undefined {
	for (const written of fieldNames(name, dialect)) {
		const field = findField(entry, written);
		if (field) return field;
	}
	return undefined;
}

/** Required slots without a value, as « author » or « author/editor ». */
function missingRequired(
	document: BibDocument,
	entry: BibEntry,
	dialect: BibDialect,
): string[] {
	// Fields may come from the entry a crossref names.
	if (findField(entry, 'crossref') || findField(entry, 'xref')) return [];
	return entryTypeSchema(entry.type, dialect)
		.required.filter((slot) => {
			const names = typeof slot === 'string' ? [slot] : slot;
			return !names.some((name) =>
				fieldText(document, slotField(entry, name, dialect)).trim(),
			);
		})
		.map((slot) => (typeof slot === 'string' ? slot : slot.join('/')));
}

function buildRows(document: BibDocument, dialect: BibDialect): Row[] {
	const keyCounts = new Map<string, number>();
	for (const entry of document.entries) {
		const key = entry.key.toLowerCase();
		keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
	}
	return document.entries.map((entry, index) => {
		const value = (...names: string[]) => {
			for (const name of names) {
				const text = fieldText(document, findField(entry, name)).trim();
				if (text) return text;
			}
			return '';
		};
		const people = value('author', 'editor');
		const problems: string[] = [];
		if (entry.error) problems.push(t(entry.error));
		if (!entry.key) problems.push(t('The entry has no key'));
		else if ((keyCounts.get(entry.key.toLowerCase()) ?? 0) > 1) {
			problems.push(t('Another entry has the key {key}', { key: entry.key }));
		}
		const missing = missingRequired(document, entry, dialect);
		if (missing.length) {
			problems.push(
				t('Missing required fields: {fields}', { fields: missing.join(', ') }),
			);
		}
		const all = [
			entry.key,
			entry.type,
			...entry.fields.map((field) => fieldText(document, field)),
		];
		return {
			index,
			entry,
			type: entry.type.toLowerCase(),
			authors: people ? authorsLabel([people]) : '',
			title: displayText(value('title')),
			year: value('year') || (/^\d{4}/.exec(value('date'))?.[0] ?? ''),
			container: displayText(
				value(
					'journaltitle',
					'journal',
					'booktitle',
					'publisher',
					'school',
					'institution',
				),
			),
			search: plainText(all.join(' ')),
			problems,
			cited: 0,
		};
	});
}

const pathLabel = (path: string) => path.replace(/^\//, '');

/** « main.tex (3), intro.tex »: where a key is cited. */
const citedFilesLabel = (uses: CitedKey) =>
	uses.files
		.map((file) =>
			file.count > 1
				? `${pathLabel(file.path)} (${file.count})`
				: pathLabel(file.path),
		)
		.join(', ');

const compareRows =
	(key: SortKey) =>
	(a: Row, b: Row): number => {
		if (key === 'year') {
			return (
				(Number.parseInt(a.year, 10) || 0) - (Number.parseInt(b.year, 10) || 0)
			);
		}
		if (key === 'cited') return a.cited - b.cited;
		const text = (row: Row) =>
			key === 'key' ? row.entry.key : plainText(row[key]);
		return text(a).localeCompare(text(b), undefined, { numeric: true });
	};

// ---------------------------------------------------------------------------

interface FieldInputProps {
	id: string;
	name: string;
	value: string;
	form?: BibField['form'];
	readOnly: boolean;
	autoFocus?: boolean;
	onCommit: (value: string) => void;
}

/** A field's value, written to the text when it loses focus or on Enter. */
const FieldInput: React.FC<FieldInputProps> = ({
	id,
	name,
	value,
	form,
	readOnly,
	autoFocus,
	onCommit,
}) => {
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	const focused = useRef(false);

	// A collaborator's change shows, unless one is typing here.
	useEffect(() => {
		if (!focused.current) {
			setDraft(value);
			setError(null);
		}
	}, [value]);

	const commit = () => {
		if (readOnly || draft === value) {
			setError(null);
			return;
		}
		try {
			onCommit(draft);
			setError(null);
		} catch (caught) {
			setError(editErrorMessage(caught));
		}
	};

	const long =
		LONG_FIELDS.has(name.toLowerCase()) ||
		value.includes('\n') ||
		value.length > 90;
	const common = {
		id,
		value: draft,
		readOnly,
		autoFocus,
		spellCheck: false,
		className: 'ui-field-control bib-field-input',
		'aria-invalid': error ? true : undefined,
		placeholder: PLACEHOLDERS[name.toLowerCase()]?.(),
		onFocus: () => {
			focused.current = true;
		},
		onBlur: () => {
			focused.current = false;
			commit();
		},
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => setDraft(event.target.value),
	};
	const onKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		if (event.key === 'Escape') {
			setDraft(value);
			setError(null);
		} else if (
			event.key === 'Enter' &&
			(!long || event.ctrlKey || event.metaKey)
		) {
			event.preventDefault();
			commit();
		}
	};

	return (
		<>
			{long ? (
				<textarea
					{...common}
					rows={Math.min(8, Math.max(2, draft.split('\n').length))}
					onKeyDown={onKeyDown}
				/>
			) : (
				<input type='text' {...common} onKeyDown={onKeyDown} />
			)}
			{form === 'expression' && (
				<span
					className='bib-field-badge'
					title={t('Written as is: a @string macro, or pieces joined by #')}
				>
					{t('macro')}
				</span>
			)}
			{error && (
				<span className='bib-field-error' role='alert'>
					{error}
				</span>
			)}
		</>
	);
};

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export const BibEntriesView: React.FC<BibEntriesViewProps> = ({
	text: liveText,
	active,
	readOnly,
	chosenDialect,
	latexDialect,
	onDialectChange,
	onEdit: onEditText,
	onShowInText,
	cursor,
	citations,
	onRenameCitations,
}) => {
	const formId = useId();
	// Viewers and reviewers read: nothing they do reaches the text.
	const onEdit = (edit: BibEdit) => {
		if (!readOnly) onEditText(edit);
	};
	// Hidden behind the text view, the list keeps its search and sort but is
	// not read again at each keystroke.
	const [text, setText] = useState(liveText);
	useEffect(() => {
		if (active) setText(liveText);
	}, [active, liveText]);
	const document = useMemo(() => parseBibDocument(text), [text]);
	const detectedDialect = useMemo(
		() => detectDialect(document.entries, document.jabrefDialect, latexDialect),
		[document, latexDialect],
	);
	const dialect = chosenDialect ?? detectedDialect;
	const parsedRows = useMemo(
		() => buildRows(document, dialect),
		[document, dialect],
	);
	const [citationRename, setCitationRename] =
		useState<CitationRenameState | null>(null);
	// What the LaTeX files cite, when the project has some.
	const latexRead = Boolean(citations && citations.files.length > 0);
	const rows = useMemo(
		() =>
			latexRead && citations
				? parsedRows.map((row) => ({
						...row,
						cited: citations.cited.get(row.entry.key)?.count ?? 0,
					}))
				: parsedRows,
		[parsedRows, citations, latexRead],
	);
	// Keys cited without an entry here or elsewhere, and the entry of this
	// file that differs only in case, if any.
	const missing = useMemo(() => {
		if (!latexRead || !citations) return [];
		const here = new Set(document.entries.map((entry) => entry.key));
		const lower = new Map<string, number>();
		document.entries.forEach((entry, index) => {
			lower.set(entry.key.toLowerCase(), index);
		});
		const renaming =
			citationRename?.status === 'busy' ? citationRename.from : null;
		return [...citations.cited]
			.filter(
				([key]) =>
					!here.has(key) && !citations.defined.has(key) && key !== renaming,
			)
			.map(([key, uses]) => ({
				key,
				uses,
				near: lower.get(key.toLowerCase()),
			}))
			.sort((a, b) => a.key.localeCompare(b.key));
	}, [citations, document, latexRead, citationRename]);

	const [query, setQuery] = useState('');
	const [sort, setSort] = useState<{
		key: SortKey;
		descending: boolean;
	} | null>(null);
	const [selection, setSelection] = useState<Selection | null>(null);
	const [showEmpty, setShowEmpty] = useState(readShowEmpty);
	const [revealed, setRevealed] = useState<string[]>([]);
	const [newField, setNewField] = useState('');
	const [newFieldError, setNewFieldError] = useState<string | null>(null);
	// The new entry panel: the identifier to look up at once, the key a
	// citation wants, if any.
	const [adding, setAdding] = useState<{ query?: string; key?: string } | null>(
		null,
	);
	const [entryError, setEntryError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [citedFilter, setCitedFilter] = useState<CitedFilter>('all');
	// Renaming a key renames its citations, unless one says not to.
	const [renameCited, setRenameCited] = useState(true);
	const listRef = useRef<HTMLElement>(null);

	// The entry the text editor's cursor was in, when the text view hands
	// over (the text it had, not the one shown before).
	// biome-ignore lint/correctness/useExhaustiveDependencies: on a hand-over only.
	useEffect(() => {
		if (!cursor) return;
		const entries = parseBibDocument(liveText).entries;
		const index = entries.findIndex(
			(entry) => entry.from <= cursor.at && cursor.at <= entry.to,
		);
		if (index >= 0) setSelection({ key: entries[index].key, index });
	}, [cursor]);

	const filter = latexRead ? citedFilter : 'all';
	const visible = useMemo(() => {
		const terms = plainText(query).split(' ').filter(Boolean);
		const found = rows.filter(
			(row) =>
				(filter === 'all' || (filter === 'cited') === row.cited > 0) &&
				terms.every((term) => row.search.includes(term)),
		);
		if (!sort) return found;
		const sorted = [...found].sort(compareRows(sort.key));
		return sort.descending ? sorted.reverse() : sorted;
	}, [rows, query, sort, filter]);
	const citedCount = useMemo(
		() => rows.filter((item) => item.cited > 0).length,
		[rows],
	);

	/** Writes `to` where `from` is cited, and tells how it went. */
	const renameCitations = async (from: string, to: string) => {
		if (!onRenameCitations || readOnly) return;
		setCitationRename({ from, to, status: 'busy' });
		try {
			const result = await onRenameCitations(from, to);
			setCitationRename({ from, to, status: 'done', result });
		} catch (caught) {
			setCitationRename({
				from,
				to,
				status: 'error',
				message: caught instanceof Error ? caught.message : String(caught),
			});
		}
	};

	const selectedIndex = resolveEntry(document.entries, selection);
	const entry = selectedIndex >= 0 ? document.entries[selectedIndex] : null;
	const row = entry ? rows[selectedIndex] : null;
	const entryIdentity = entry ? `${selectedIndex}:${entry.key}` : '';

	// A new entry shows its fields from scratch.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on another entry only.
	useEffect(() => {
		setRevealed([]);
		setNewField('');
		setNewFieldError(null);
		setEntryError(null);
		setConfirmDelete(false);
	}, [entryIdentity]);

	// The first entry, when none is chosen yet.
	useEffect(() => {
		if (!selection && document.entries.length > 0 && cursor == null) {
			setSelection({ key: document.entries[0].key, index: 0 });
		}
	}, [selection, document, cursor]);

	const select = (index: number) => {
		const target = document.entries[index];
		if (target) setSelection({ key: target.key, index });
	};

	/** Runs an edit on the selected entry, as it is in the text then. */
	const editEntry = (
		make: (text: string, entry: BibEntry) => BibChange[],
		keyAfter?: string,
	) => {
		const target = selection;
		onEdit((current) => {
			const fresh = parseBibDocument(current);
			const index = resolveEntry(fresh.entries, target);
			if (index < 0) return [];
			return make(current, fresh.entries[index]);
		});
		if (keyAfter !== undefined && target) {
			setSelection({ key: keyAfter, index: target.index });
		}
	};

	const toggleSort = (key: SortKey) => {
		setSort((current) => {
			if (!current || current.key !== key) return { key, descending: false };
			if (!current.descending) return { key, descending: true };
			return null;
		});
	};

	const moveSelection = (event: React.KeyboardEvent) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		const position = visible.findIndex((item) => item.index === selectedIndex);
		const next =
			event.key === 'ArrowDown'
				? Math.min(visible.length - 1, position + 1)
				: Math.max(0, position - 1);
		if (visible[next]) select(visible[next].index);
	};

	// The selected row stays in sight.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on selection only.
	useEffect(() => {
		listRef.current
			?.querySelector('[aria-selected="true"]')
			?.scrollIntoView({ block: 'nearest' });
	}, [entryIdentity]);

	const sortHeader = (key: SortKey, label: string) => (
		<th
			scope='col'
			aria-sort={
				sort?.key === key
					? sort.descending
						? 'descending'
						: 'ascending'
					: 'none'
			}
		>
			<button
				type='button'
				className='bib-sort-button'
				onClick={() => toggleSort(key)}
			>
				{label}
				<span className='bib-sort-mark' aria-hidden='true'>
					{sort?.key === key ? (sort.descending ? '▼' : '▲') : ''}
				</span>
			</button>
		</th>
	);

	const types = ENTRY_TYPE_ORDER[dialect];

	// --- The form's rows ----------------------------------------------------

	const renderField = (
		name: string,
		options: { required?: boolean; autoFocus?: boolean } = {},
	) => {
		if (!entry) return null;
		const field = slotField(entry, name, dialect);
		const written = field?.name ?? name;
		const id = `${formId}-${written}`;
		const description = fieldDescription(name);
		return (
			<div
				className='bib-field'
				key={name}
				data-required={options.required || undefined}
			>
				<label htmlFor={id} className='bib-field-label' title={description}>
					{name}
					{field && field.name.toLowerCase() !== name && (
						<span className='bib-field-alias'>
							{' '}
							{t('(written {name})', { name: field.name })}
						</span>
					)}
				</label>
				<div className='bib-field-value'>
					<FieldInput
						id={id}
						name={name}
						value={field?.value ?? ''}
						form={field?.form}
						readOnly={readOnly}
						autoFocus={options.autoFocus}
						onCommit={(value) =>
							editEntry((current, target) =>
								setFieldChanges(
									current,
									target,
									slotField(target, name, dialect)?.name ?? name,
									value,
								),
							)
						}
					/>
				</div>
				{field && !readOnly && (
					<button
						type='button'
						className='ui-icon-button bib-field-remove'
						data-variant='subtle'
						data-size='xs'
						title={t('Remove the field {name}', { name: field.name })}
						aria-label={t('Remove the field {name}', { name: field.name })}
						onClick={() => {
							try {
								editEntry((current, target) =>
									deleteFieldChanges(current, target, field.name),
								);
							} catch (caught) {
								setEntryError(editErrorMessage(caught));
							}
						}}
					>
						×
					</button>
				)}
			</div>
		);
	};

	const renderForm = () => {
		if (!entry || !row) return null;
		const schema = entryTypeSchema(entry.type, dialect);
		const shown = new Set<string>();
		const used = new Set<string>();
		const mark = (name: string) => {
			shown.add(name);
			const field = slotField(entry, name, dialect);
			if (field) used.add(field.name.toLowerCase());
		};

		const required = schema.required.map((slot: RequiredSlot) => {
			if (typeof slot === 'string') {
				mark(slot);
				return renderField(slot, { required: true });
			}
			for (const name of slot) mark(name);
			const satisfied = slot.some((name) =>
				fieldText(document, slotField(entry, name, dialect)).trim(),
			);
			return (
				<fieldset
					className='bib-field-group'
					key={slot.join('/')}
					data-satisfied={satisfied || undefined}
				>
					<legend>{t('One of: {fields}', { fields: slot.join(', ') })}</legend>
					{slot.map((name) => renderField(name, { required: true }))}
				</fieldset>
			);
		});

		const optionalNames = [
			...schema.optional,
			...schema.general.filter((name) => !schema.optional.includes(name)),
		].filter((name) => !shown.has(name));
		const optionalFilled = optionalNames.filter(
			(name) => slotField(entry, name, dialect) || revealed.includes(name),
		);
		const optionalEmpty = optionalNames.filter(
			(name) => !optionalFilled.includes(name),
		);
		for (const name of optionalNames) mark(name);

		const others = entry.fields.filter(
			(field) => !used.has(field.name.toLowerCase()),
		);
		const extra = revealed.filter(
			(name) =>
				!shown.has(name) &&
				!entry.fields.some((field) => field.name.toLowerCase() === name),
		);

		const addField = () => {
			const name = newField.trim().toLowerCase();
			if (!name) return;
			if (!/^[a-z][\w\-.:]*$/.test(name)) {
				setNewFieldError(
					t(
						'A field name starts with a letter, then letters, digits or - _ . :',
					),
				);
				return;
			}
			setNewFieldError(null);
			setNewField('');
			setRevealed((current) => [
				...current.filter((item) => item !== name),
				name,
			]);
		};

		return (
			<>
				<section className='bib-form-section'>
					<h4>{t('Required fields')}</h4>
					{required.length ? (
						required
					) : (
						<p className='ui-meta'>{t('None for this type')}</p>
					)}
				</section>
				<section className='bib-form-section'>
					<h4>{t('Optional fields')}</h4>
					{optionalFilled.map((name) =>
						renderField(name, {
							autoFocus: revealed[revealed.length - 1] === name,
						}),
					)}
					{showEmpty && optionalEmpty.map((name) => renderField(name))}
					{optionalEmpty.length > 0 && (
						<label className='bib-show-empty'>
							<input
								type='checkbox'
								checked={showEmpty}
								onChange={(event) => {
									setShowEmpty(event.target.checked);
									try {
										localStorage.setItem(
											SHOW_EMPTY_KEY,
											String(event.target.checked),
										);
									} catch {
										// Not kept: private browsing.
									}
								}}
							/>
							{t('Show the empty optional fields ({count})', {
								count: optionalEmpty.length,
							})}
						</label>
					)}
				</section>
				{(others.length > 0 || extra.length > 0) && (
					<section className='bib-form-section'>
						<h4>{t('Other fields')}</h4>
						{others.map((field) => renderField(field.name.toLowerCase()))}
						{extra.map((name) =>
							renderField(name, {
								autoFocus: revealed[revealed.length - 1] === name,
							}),
						)}
					</section>
				)}
				{!readOnly && (
					<div className='bib-add-field'>
						<input
							type='text'
							className='ui-field-control'
							list={`${formId}-field-names`}
							value={newField}
							placeholder={t('Field name')}
							aria-label={t('Field name')}
							onChange={(event) => setNewField(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									addField();
								}
							}}
						/>
						<datalist id={`${formId}-field-names`}>
							{validFieldNames(dialect).map((name) => (
								<option key={name} value={name} />
							))}
						</datalist>
						<button type='button' className='button' onClick={addField}>
							<PlusIcon />
							{t('Add a field')}
						</button>
						{newFieldError && (
							<span className='bib-field-error' role='alert'>
								{newFieldError}
							</span>
						)}
					</div>
				)}
			</>
		);
	};

	const renderDetail = () => {
		if (!entry || !row) {
			return (
				<div className='bib-detail-empty ui-empty-state'>
					<p>
						{document.entries.length
							? t('Choose an entry in the list.')
							: t('This file has no entry yet.')}
					</p>
				</div>
			);
		}
		const broken = Boolean(entry.error || entry.close === null);
		const annotated = text.slice(entry.from, entry.to).includes('<###');
		const locked = readOnly || broken || annotated;
		const knownType = types.includes(entry.type.toLowerCase());
		const uses = citations?.cited.get(entry.key);
		const renamesCitations = Boolean(
			uses && renameCited && onRenameCitations && !locked,
		);
		const renaming =
			citationRename && citationRename.to === entry.key ? citationRename : null;
		return (
			<div className='bib-detail' key={entryIdentity}>
				<div className='bib-detail-header'>
					<label className='bib-detail-type'>
						<span>{t('Type')}</span>
						<select
							className='ui-field-control'
							value={entry.type.toLowerCase()}
							disabled={locked}
							onChange={(event) => {
								try {
									editEntry((_current, target) =>
										changeTypeChanges(target, event.target.value),
									);
								} catch (caught) {
									setEntryError(editErrorMessage(caught));
								}
							}}
						>
							{!knownType && (
								<option value={entry.type.toLowerCase()}>
									{t('{type} (unknown in {dialect})', {
										type: entry.type.toLowerCase(),
										dialect: dialect === 'biblatex' ? 'biblatex' : 'BibTeX',
									})}
								</option>
							)}
							{types.map((type) => (
								<option key={type} value={type}>
									{type}
								</option>
							))}
						</select>
					</label>
					<label className='bib-detail-key' htmlFor={`${formId}-key`}>
						<span>{t('Key')}</span>
						<KeyInput
							id={`${formId}-key`}
							value={entry.key}
							readOnly={locked}
							taken={(key) =>
								document.entries.some(
									(other, index) =>
										index !== selectedIndex &&
										other.key.toLowerCase() === key.toLowerCase(),
								)
							}
							onCommit={(key) => {
								const before = entry.key;
								editEntry(
									(_current, target) => renameKeyChanges(target, key),
									key,
								);
								if (renamesCitations) void renameCitations(before, key);
							}}
						/>
					</label>
					<div className='bib-detail-actions'>
						<button
							type='button'
							className='button'
							onClick={() => onShowInText(entry.from, entry.to)}
							title={t('Show this entry in the text')}
						>
							<FileTextIcon />
							{t('In the text')}
						</button>
						{!readOnly && (
							<button
								type='button'
								className={`button${confirmDelete ? ' danger' : ''}`}
								onClick={() => {
									if (!confirmDelete) {
										setConfirmDelete(true);
										return;
									}
									editEntry((current, target) =>
										deleteEntryChanges(current, target),
									);
									// The next entry takes its place, else the one before.
									const after = document.entries[selectedIndex + 1];
									const before = document.entries[selectedIndex - 1];
									setSelection(
										after
											? { key: after.key, index: selectedIndex }
											: before
												? { key: before.key, index: selectedIndex - 1 }
												: null,
									);
								}}
								onBlur={() => setConfirmDelete(false)}
								title={t('Delete this entry')}
							>
								<TrashIcon />
								{confirmDelete ? t('Delete it?') : t('Delete')}
							</button>
						)}
					</div>
				</div>

				{latexRead && citations && renaming?.status !== 'busy' && (
					<div className='bib-cited-line ui-meta'>
						<span>
							{uses
								? t('Cited {count} times in {files}', {
										count: uses.count,
										files: citedFilesLabel(uses),
									})
								: citations.everything.length
									? t('Not cited, but in the bibliography by \\nocite{*}')
									: t('Not cited in the LaTeX files')}
						</span>
						{uses && onRenameCitations && !locked && (
							<label className='bib-rename-citations'>
								<input
									type='checkbox'
									checked={renameCited}
									onChange={(event) => setRenameCited(event.target.checked)}
								/>
								{t('Rename them with the key')}
							</label>
						)}
					</div>
				)}
				{renaming && (
					<p
						className={
							renaming.status === 'error'
								? 'bib-rename-status bib-field-error'
								: 'bib-rename-status ui-meta'
						}
						role={renaming.status === 'error' ? 'alert' : 'status'}
					>
						{renaming.status === 'done' && <CheckIcon />}
						{renaming.status === 'busy'
							? t('Renaming the citations of {key}…', { key: renaming.from })
							: renaming.status === 'error'
								? t('The citations of {key} could not be renamed: {error}', {
										key: renaming.from,
										error: renaming.message ?? '',
									})
								: renaming.result && renaming.result.count > 0
									? t('{count} citations of {key} renamed in {files}', {
											count: renaming.result.count,
											key: renaming.from,
											files: renaming.result.files.map(pathLabel).join(', '),
										})
									: t('No citation of {key} left to rename', {
											key: renaming.from,
										})}
					</p>
				)}
				{(broken || annotated) && (
					<div className='ui-message' data-tone='warning' data-spacing='inset'>
						{broken
							? t('This entry cannot be read to its end: fix it in the text')
							: t(
									'This entry has comments or tracked changes: change it in the text',
								)}
					</div>
				)}
				{entryError && (
					<div
						className='ui-message'
						data-tone='error'
						data-spacing='inset'
						role='alert'
					>
						{entryError}
					</div>
				)}
				{row.problems.length > 0 && !broken && (
					<ul className='bib-problems'>
						{row.problems.map((problem) => (
							<li key={problem}>{problem}</li>
						))}
					</ul>
				)}

				<section className='bib-preview' aria-label={t('Preview')}>
					<BibPreview pieces={previewEntry(document, entry)} />
				</section>

				<fieldset className='bib-form' disabled={locked}>
					{renderForm()}
				</fieldset>

				<details className='bib-source'>
					<summary>{t('Source')}</summary>
					<pre>{text.slice(entry.from, entry.to)}</pre>
				</details>
			</div>
		);
	};

	return (
		<div className='bib-entries' data-readonly={readOnly || undefined}>
			<div className='bib-entries-toolbar'>
				<div className='bib-search'>
					<SearchIcon />
					<input
						type='search'
						className='ui-field-control'
						value={query}
						placeholder={t('Search the entries')}
						aria-label={t('Search the entries')}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'ArrowDown') {
								event.preventDefault();
								if (visible[0]) select(visible[0].index);
								listRef.current?.focus();
							}
						}}
					/>
				</div>
				{latexRead && (
					<span className='bib-cited-filter'>
						<select
							className='ui-field-control'
							value={citedFilter}
							aria-label={t('Entries cited in the LaTeX files of the project')}
							title={t('Entries cited in the LaTeX files of the project')}
							onChange={(event) =>
								setCitedFilter(event.target.value as CitedFilter)
							}
						>
							<option value='all'>{t('All the entries')}</option>
							<option value='cited'>
								{t('Cited ({number})', { number: citedCount })}
							</option>
							<option value='uncited'>
								{t('Not cited ({number})', {
									number: rows.length - citedCount,
								})}
							</option>
						</select>
					</span>
				)}
				<span className='bib-count ui-meta' aria-live='polite'>
					{query || filter !== 'all'
						? t('{shown} of {count} entries', {
								shown: visible.length,
								count: rows.length,
							})
						: t('{count} entries', { count: rows.length })}
				</span>
				<label
					className='bib-dialect'
					title={t(
						'The fields each type requires or accepts differ between BibTeX and biblatex. Automatic: as the LaTeX files load the bibliography, else as the entries are written.',
					)}
				>
					<span>{t('Fields of')}</span>
					<select
						className='ui-field-control'
						value={chosenDialect ?? 'auto'}
						onChange={(event) =>
							onDialectChange(
								event.target.value === 'auto'
									? null
									: (event.target.value as BibDialect),
							)
						}
					>
						<option value='auto'>
							{t('Automatic ({dialect})', {
								dialect: detectedDialect === 'biblatex' ? 'biblatex' : 'BibTeX',
							})}
						</option>
						<option value='bibtex'>BibTeX</option>
						<option value='biblatex'>biblatex</option>
					</select>
				</label>
				{!readOnly && (
					<button
						type='button'
						className='button primary'
						onClick={() => setAdding((current) => (current ? null : {}))}
					>
						<PlusIcon />
						{t('New entry')}
					</button>
				)}
			</div>

			{adding && !readOnly && (
				<NewEntryPanel
					// A new identifier from the search box: a new lookup.
					key={`${adding.query ?? ''} ${adding.key ?? ''}`}
					text={text}
					document={document}
					dialect={dialect}
					types={types}
					initialQuery={adding.query}
					citedKey={adding.key}
					onEdit={onEdit}
					onAdded={(key) => {
						setAdding(null);
						setQuery('');
						setSelection({ key, index: document.entries.length });
					}}
					onShowEntry={(index) => {
						setQuery('');
						select(index);
					}}
					onClose={() => setAdding(null)}
				/>
			)}

			{document.errors.length > 0 && (
				<div className='ui-message' data-tone='warning' data-spacing='inset'>
					{t('{count} problems in the text: the entries concerned are marked', {
						count: document.errors.length,
					})}
				</div>
			)}

			{missing.length > 0 && (
				<details className='bib-missing'>
					<summary>
						<AlertCircleIcon />
						{t('{count} keys cited in the LaTeX files have no entry', {
							count: missing.length,
						})}
					</summary>
					<ul>
						{missing.map((item) => {
							const near =
								item.near !== undefined ? document.entries[item.near] : null;
							return (
								<li key={item.key}>
									<code>{item.key}</code>
									<span className='ui-meta'>{citedFilesLabel(item.uses)}</span>
									{near && (
										<span className='bib-missing-near'>
											{t('Differs in case only from')}{' '}
											<button
												type='button'
												className='bib-link-button'
												onClick={() => {
													setQuery('');
													select(item.near as number);
												}}
											>
												{near.key}
											</button>
										</span>
									)}
									{!readOnly &&
										(near ? (
											onRenameCitations && (
												<button
													type='button'
													className='button'
													disabled={citationRename?.status === 'busy'}
													title={t('Write {key} in the citations', {
														key: near.key,
													})}
													onClick={() => {
														setQuery('');
														select(item.near as number);
														void renameCitations(item.key, near.key);
													}}
												>
													{t('Correct the citations')}
												</button>
											)
										) : (
											<button
												type='button'
												className='button'
												onClick={() => setAdding({ key: item.key })}
											>
												<PlusIcon />
												{t('Add its entry')}
											</button>
										))}
								</li>
							);
						})}
					</ul>
				</details>
			)}

			<div className='bib-entries-main'>
				<section
					className='bib-entry-list'
					ref={listRef}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: the arrows move in the list.
					tabIndex={0}
					onKeyDown={moveSelection}
					aria-label={t('Entries')}
				>
					<table className='bib-entry-table'>
						<thead>
							<tr>
								{sortHeader('type', t('Type'))}
								{sortHeader('key', t('Key'))}
								{sortHeader('authors', t('Authors'))}
								{sortHeader('title', t('Title'))}
								{sortHeader('year', t('Year'))}
								{sortHeader('container', t('Published in'))}
								{latexRead && sortHeader('cited', t('Citations'))}
							</tr>
						</thead>
						<tbody>
							{visible.map((item) => (
								<tr
									key={`${item.index}:${item.entry.key}`}
									aria-selected={item.index === selectedIndex}
									onClick={() => select(item.index)}
									data-problem={item.problems.length > 0 || undefined}
								>
									<td className='bib-cell-type'>{item.type}</td>
									<td className='bib-cell-key'>
										{item.problems.length > 0 && (
											<span
												className='bib-problem-mark'
												title={item.problems.join('\n')}
											>
												<AlertCircleIcon />
											</span>
										)}
										{item.entry.key || <em className='ui-meta'>—</em>}
									</td>
									<td>{item.authors}</td>
									<td className='bib-cell-title'>{item.title}</td>
									<td className='bib-cell-year'>{item.year}</td>
									<td>{item.container}</td>
									{latexRead && (
										<td
											className='bib-cell-cited'
											title={(() => {
												const uses = citations?.cited.get(item.entry.key);
												return uses
													? citedFilesLabel(uses)
													: t('Not cited in the LaTeX files');
											})()}
										>
											{item.cited || <span className='ui-meta'>—</span>}
										</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
					{visible.length === 0 && (
						<div className='bib-list-empty ui-meta'>
							<p>
								{!rows.length
									? t('This file has no entry yet.')
									: query
										? t('No entry has these words')
										: filter === 'cited'
											? t('No entry is cited')
											: t('Every entry is cited')}
							</p>
							{/* An identifier searched for and not there: added from it. */}
							{!readOnly &&
								(() => {
									const identifier = parseIdentifier(query);
									return identifier && identifier.kind !== 'invalid-isbn' ? (
										<button
											type='button'
											className='button'
											onClick={() => setAdding({ query })}
										>
											<PlusIcon />
											{t('Add the reference this identifier gives')}
										</button>
									) : null;
								})()}
						</div>
					)}
				</section>

				<div className='bib-entry-detail'>{renderDetail()}</div>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------

interface KeyInputProps {
	id: string;
	value: string;
	readOnly: boolean;
	taken: (key: string) => boolean;
	onCommit: (key: string) => void;
}

/** The key, renamed when it loses focus or on Enter. */
const KeyInput: React.FC<KeyInputProps> = ({
	id,
	value,
	readOnly,
	taken,
	onCommit,
}) => {
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	const focused = useRef(false);

	useEffect(() => {
		if (!focused.current) setDraft(value);
	}, [value]);

	const commit = () => {
		const key = draft.trim();
		if (readOnly || key === value) {
			setError(null);
			return;
		}
		try {
			checkKey(key);
			onCommit(key);
			setError(null);
		} catch (caught) {
			setError(editErrorMessage(caught));
		}
	};

	const warning = draft.trim() !== value && taken(draft.trim());
	return (
		<>
			<input
				id={id}
				type='text'
				className='ui-field-control'
				value={draft}
				readOnly={readOnly}
				spellCheck={false}
				aria-invalid={error ? true : undefined}
				onFocus={() => {
					focused.current = true;
				}}
				onBlur={() => {
					focused.current = false;
					commit();
				}}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						commit();
					} else if (event.key === 'Escape') {
						setDraft(value);
						setError(null);
					}
				}}
			/>
			{(error || warning) && (
				<span className='bib-field-error' role='alert'>
					{error ?? t('Another entry has this key')}
				</span>
			)}
		</>
	);
};

export default BibEntriesView;
