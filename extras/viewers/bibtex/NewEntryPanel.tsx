// extras/viewers/bibtex/NewEntryPanel.tsx
// A new entry, as JabRef's « New entry from ID »: a DOI, an arXiv number or
// an ISBN gives the work's metadata (src/services/BibMetadataService.ts),
// shown as the entry it makes in the file's dialect, with a key to change
// before adding it; or an empty entry of a chosen type.
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
	AlertCircleIcon,
	CloseIcon,
	PlusIcon,
	SearchIcon,
} from '@/components/common/Icons';
import { t } from '@/i18n';
import { LookupError, lookUpIdentifier } from '@/services/BibMetadataService';
import {
	addEntryChanges,
	appendEntryChanges,
	type BibChange,
	type BibDocument,
	BibEditError,
	checkKey,
	documentLayout,
	fieldText,
	findField,
	parseBibDocument,
	writeEntry,
} from '@/utils/bibDocument';
import type { BibDialect } from '@/utils/bibEntryTypes';
import {
	makeKey,
	toBibEntry,
	type WorkMetadata,
} from '@/utils/bibFromMetadata';
import {
	type BibIdentifier,
	isbn13,
	parseIdentifier,
} from '@/utils/bibIdentifiers';
import { previewEntry } from '@/utils/bibPreview';
import { BibPreview, editErrorMessage } from './BibPreview';

interface NewEntryPanelProps {
	/** The file's text, to write the entry as its others are. */
	text: string;
	document: BibDocument;
	dialect: BibDialect;
	types: string[];
	/** An identifier to look up at once (typed in the search box). */
	initialQuery?: string;
	/** The key a citation of the LaTeX files wants: the entry's key. */
	citedKey?: string;
	onEdit: (edit: (text: string) => BibChange[]) => void;
	/** The entry added, at the end of the file. */
	onAdded: (key: string) => void;
	onShowEntry: (index: number) => void;
	onClose: () => void;
}

type Lookup =
	| { status: 'idle' }
	| { status: 'busy'; identifier: BibIdentifier }
	| { status: 'error'; message: string }
	| { status: 'found'; identifier: BibIdentifier; meta: WorkMetadata };

const KIND_LABEL: Record<BibIdentifier['kind'], string> = {
	doi: 'DOI',
	arxiv: 'arXiv',
	isbn: 'ISBN',
};

// A month in BibTeX is a macro, written bare.
const bare = (name: string, value: string) =>
	name === 'month' && /^[a-z]{3}$/.test(value);

const normalDoi = (value: string) =>
	value
		.trim()
		.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
		.replace(/^doi:\s*/i, '')
		.toLowerCase();

/** The entry of the file the identifier is already in, if any. */
function alreadyIn(
	document: BibDocument,
	identifier: BibIdentifier,
	meta: WorkMetadata,
): number {
	const doi = meta.doi ? normalDoi(meta.doi) : null;
	return document.entries.findIndex((entry) => {
		const value = (name: string) => fieldText(document, findField(entry, name));
		if (doi && value('doi') && normalDoi(value('doi')) === doi) return true;
		if (identifier.kind === 'arxiv') {
			return value('eprint').replace(/v\d+$/, '').trim() === identifier.id;
		}
		if (identifier.kind === 'isbn') {
			const isbn = value('isbn').replace(/[\s-]/g, '').toUpperCase();
			return (
				isbn !== '' &&
				(isbn === identifier.id ||
					((isbn.length === 10 || isbn.length === 13) &&
						isbn13(isbn) === isbn13(identifier.id)))
			);
		}
		return false;
	});
}

export const NewEntryPanel: React.FC<NewEntryPanelProps> = ({
	text,
	document,
	dialect,
	types,
	initialQuery,
	citedKey,
	onEdit,
	onAdded,
	onShowEntry,
	onClose,
}) => {
	const [query, setQuery] = useState(initialQuery ?? '');
	const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });
	const [key, setKey] = useState('');
	const [addError, setAddError] = useState<string | null>(null);
	const [empty, setEmpty] = useState<{
		type: string;
		key: string;
		error?: string;
	}>({
		type: types[0] ?? 'article',
		key: citedKey ?? '',
	});
	// The last lookup asked: an earlier answer arriving later is ignored.
	const request = useRef(0);
	useEffect(
		() => () => {
			request.current++;
		},
		[],
	);

	const keys = useMemo(
		() => document.entries.map((entry) => entry.key),
		[document],
	);
	const taken = (candidate: string) =>
		keys.some((existing) => existing.toLowerCase() === candidate.toLowerCase());

	const runLookup = async (input: string) => {
		const identifier = parseIdentifier(input);
		setAddError(null);
		if (!identifier) {
			setLookup({
				status: 'error',
				message: t(
					'Neither a DOI, an arXiv number nor an ISBN, such as {examples}',
					{
						examples: '10.1103/PhysRev.47.777, 1706.03762, 978-0-262-03561-3',
					},
				),
			});
			return;
		}
		if (identifier.kind === 'invalid-isbn') {
			setLookup({
				status: 'error',
				message: t(
					'This ISBN is not valid: its last digit does not match the others',
				),
			});
			return;
		}
		const asked = ++request.current;
		setLookup({ status: 'busy', identifier });
		try {
			const meta = await lookUpIdentifier(identifier);
			if (asked !== request.current) return;
			if (!meta) {
				setLookup({
					status: 'error',
					message: t('No reference found for {kind} {id}', {
						kind: KIND_LABEL[identifier.kind],
						id: identifier.id,
					}),
				});
				return;
			}
			setKey(citedKey ?? makeKey(meta, keys));
			setLookup({ status: 'found', identifier, meta });
		} catch (error) {
			if (asked !== request.current) return;
			setLookup({
				status: 'error',
				message:
					error instanceof LookupError
						? t(error.message, {
								service: error.service,
								status: error.status ?? '',
							})
						: String(error),
			});
		}
	};

	// An identifier typed in the search box: looked up at once.
	// biome-ignore lint/correctness/useExhaustiveDependencies: on opening only.
	useEffect(() => {
		if (initialQuery) void runLookup(initialQuery);
	}, []);

	const found = lookup.status === 'found' ? lookup : null;
	// The entry in the dialect shown now (it may change while one looks).
	const entry = useMemo(
		() => (found ? toBibEntry(found.meta, dialect) : null),
		[found, dialect],
	);
	// As it will be written: the file's layout, the key as typed (or a
	// stand-in while it cannot be one).
	const layout = useMemo(() => documentLayout(text), [text]);
	const written = useMemo(() => {
		if (!entry) return null;
		const typed = key.trim();
		let shown = 'key';
		try {
			checkKey(typed);
			shown = typed;
		} catch {
			// The stand-in.
		}
		return writeEntry(entry.type, shown, entry.fields, layout, bare);
	}, [entry, key, layout]);
	const preview = useMemo(() => {
		if (!written) return null;
		const parsed = parseBibDocument(written);
		return parsed.entries[0] ? previewEntry(parsed, parsed.entries[0]) : null;
	}, [written]);
	const existing = found
		? alreadyIn(document, found.identifier, found.meta)
		: -1;

	const add = () => {
		if (!entry) return;
		const chosen = key.trim();
		try {
			checkKey(chosen);
			if (taken(chosen)) throw new BibEditError('Another entry has this key');
			onEdit((current) =>
				appendEntryChanges(
					current,
					writeEntry(
						entry.type,
						chosen,
						entry.fields,
						documentLayout(current),
						bare,
					),
				),
			);
			onAdded(chosen);
		} catch (error) {
			setAddError(editErrorMessage(error));
		}
	};

	const createEmpty = () => {
		const chosen = empty.key.trim();
		try {
			checkKey(chosen);
			if (taken(chosen)) throw new BibEditError('Another entry has this key');
			onEdit((current) => addEntryChanges(current, empty.type, chosen));
			onAdded(chosen);
		} catch (error) {
			setEmpty({ ...empty, error: editErrorMessage(error) });
		}
	};

	const title = citedKey
		? `${t('New entry for the citation')} ${citedKey}`
		: t('New entry');

	return (
		<section
			className='bib-new-entry'
			aria-label={title}
			onKeyDown={(event) => {
				if (event.key === 'Escape') onClose();
			}}
		>
			<div className='bib-new-entry-header'>
				<h4>
					{citedKey ? (
						<>
							{t('New entry for the citation')} <code>{citedKey}</code>
						</>
					) : (
						title
					)}
				</h4>
				<button
					type='button'
					className='ui-icon-button'
					data-variant='subtle'
					title={t('Close')}
					aria-label={t('Close')}
					onClick={onClose}
				>
					<CloseIcon />
				</button>
			</div>

			<form
				className='bib-new-entry-row'
				onSubmit={(event) => {
					event.preventDefault();
					void runLookup(query);
				}}
			>
				<label className='bib-new-entry-identifier'>
					<span>{t('From its DOI, arXiv number or ISBN')}</span>
					<input
						type='text'
						className='ui-field-control'
						value={query}
						spellCheck={false}
						// biome-ignore lint/a11y/noAutofocus: the identifier is what one types next.
						autoFocus
						placeholder='10.1103/PhysRev.47.777 · 1706.03762 · 978-0-262-03561-3'
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
				<button
					type='submit'
					className='button primary'
					disabled={!query.trim() || lookup.status === 'busy'}
				>
					<SearchIcon />
					{t('Look up')}
				</button>
			</form>

			{lookup.status === 'busy' && (
				<p className='ui-meta' aria-live='polite'>
					{t('Looking up {kind} {id}…', {
						kind: KIND_LABEL[lookup.identifier.kind],
						id: lookup.identifier.id,
					})}
				</p>
			)}
			{lookup.status === 'error' && (
				<p className='bib-field-error' role='alert'>
					{lookup.message}
				</p>
			)}

			{found && entry && (
				<div className='bib-new-entry-found'>
					{existing >= 0 && (
						<p className='bib-new-entry-duplicate' role='status'>
							<AlertCircleIcon />
							<span>
								{t('This reference is already in the file:')}{' '}
								<button
									type='button'
									className='bib-link-button'
									onClick={() => onShowEntry(existing)}
								>
									{document.entries[existing].key}
								</button>
							</span>
						</p>
					)}
					{preview && (
						<div className='bib-preview'>
							<BibPreview pieces={preview} />
						</div>
					)}
					<form
						className='bib-new-entry-row'
						onSubmit={(event) => {
							event.preventDefault();
							add();
						}}
					>
						<span className='bib-new-entry-type'>
							<span>{t('Type')}</span>
							<code>@{entry.type}</code>
						</span>
						<label>
							<span>{t('Key')}</span>
							<input
								type='text'
								className='ui-field-control'
								value={key}
								spellCheck={false}
								onChange={(event) => {
									setKey(event.target.value);
									setAddError(null);
								}}
							/>
						</label>
						<button type='submit' className='button primary'>
							<PlusIcon />
							{t('Add to the file')}
						</button>
						{(addError || taken(key.trim())) && (
							<span className='bib-field-error' role='alert'>
								{addError ?? t('Another entry has this key')}
							</span>
						)}
					</form>
					{written && (
						<details className='bib-source'>
							<summary>{t('Source')}</summary>
							<pre>{written}</pre>
						</details>
					)}
				</div>
			)}

			<form
				className='bib-new-entry-row bib-new-entry-empty'
				onSubmit={(event) => {
					event.preventDefault();
					createEmpty();
				}}
			>
				<span className='ui-meta'>{t('Or an empty entry:')}</span>
				<label>
					<span>{t('Type')}</span>
					<select
						className='ui-field-control'
						value={empty.type}
						onChange={(event) =>
							setEmpty({ ...empty, type: event.target.value })
						}
					>
						{types.map((type) => (
							<option key={type} value={type}>
								{type}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>{t('Key')}</span>
					<input
						type='text'
						className='ui-field-control'
						value={empty.key}
						spellCheck={false}
						placeholder={t('e.g. einstein1905')}
						onChange={(event) =>
							setEmpty({ ...empty, key: event.target.value, error: undefined })
						}
					/>
				</label>
				<button type='submit' className='button'>
					{t('Create')}
				</button>
				{empty.error && (
					<span className='bib-field-error' role='alert'>
						{empty.error}
					</span>
				)}
			</form>
		</section>
	);
};

export default NewEntryPanel;
