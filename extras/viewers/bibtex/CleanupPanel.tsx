// extras/viewers/bibtex/CleanupPanel.tsx
// The cleanups of src/utils/bibCleanup.ts, as JabRef's « Cleanup entries »:
// which ones, on which entries, and each change they make, shown before it
// is made (and left out when unchecked). They are made in one edit of the
// text, which « Text »'s undo takes back.
import type React from 'react';
import { useMemo, useState } from 'react';

import { CloseIcon } from '@/components/common/Icons';
import { t } from '@/i18n';
import {
	CLEANUP_KINDS,
	type CleanupChange,
	type CleanupKind,
	cleanupChanges,
} from '@/utils/bibCleanup';
import { type BibDocument, parseBibDocument } from '@/utils/bibDocument';
import { findEntryIndex } from '@/utils/bibDuplicates';
import type { BibDialect } from '@/utils/bibEntryTypes';
import { editErrorMessage } from './BibPreview';
import type { BibEdit } from './BibEntriesView';

type Scope = 'all' | 'shown' | 'entry';

interface CleanupPanelProps {
	document: BibDocument;
	dialect: BibDialect;
	/** The entries the list shows, when a search or a filter narrows it. */
	shown: number[] | null;
	/** The entry shown, if any. */
	selected: number;
	onEdit: (edit: BibEdit) => void;
	onClose: () => void;
}

const LABELS: Record<CleanupKind, () => string> = {
	encoding: () => t('Characters encoded twice'),
	pages: () => t('Page ranges'),
	doi: () => t('DOIs without their link'),
	escape: () => t('Special characters escaped'),
	latex: () => t('Accents and typography in LaTeX'),
	capitals: () => t('Capitals protected in titles'),
};
const EXAMPLES: Record<CleanupKind, string> = {
	encoding: 'TrÃ©panier → Trépanier',
	pages: '12-34 → 12--34',
	doi: 'https://doi.org/10.1… → 10.1…',
	escape: '& % # _ → \\& \\% \\# \\_',
	latex: "é – “ ” → {\\'e} -- `` ''",
	capitals: 'DNA, Monte Carlo → {DNA}, {Monte} {Carlo}',
};
const NOTES: Partial<Record<CleanupKind, () => string>> = {
	latex: () => t('For BibTeX; biber reads Unicode'),
};
const TITLES: Partial<Record<CleanupKind, () => string>> = {
	capitals: () =>
		t(
			'Acronyms; and in a title in sentence case, the words with a capital (proper nouns)',
		),
};

const changeId = (change: { key: string; field: string }) =>
	`${change.key}\n${change.field.toLowerCase()}`;

/** The part of a value that changes, with some of what surrounds it. */
function changedPart(before: string, after: string) {
	let start = 0;
	while (
		start < before.length &&
		start < after.length &&
		before[start] === after[start]
	) {
		start++;
	}
	let end = 0;
	while (
		end < before.length - start &&
		end < after.length - start &&
		before[before.length - 1 - end] === after[after.length - 1 - end]
	) {
		end++;
	}
	const context = 24;
	const head = before.slice(Math.max(0, start - context), start);
	const tail = before.slice(before.length - end).slice(0, context);
	return {
		head: (start > context ? '…' : '') + head,
		removed: before.slice(start, before.length - end),
		added: after.slice(start, after.length - end),
		tail: tail + (end > context ? '…' : ''),
	};
}

const Change: React.FC<{ change: CleanupChange }> = ({ change }) => {
	const part = changedPart(change.before, change.after);
	return (
		<>
			<td className='bib-cleanup-value'>
				{part.head}
				<del>{part.removed}</del>
				{part.tail}
			</td>
			<td className='bib-cleanup-value'>
				{part.head}
				<ins>{part.added}</ins>
				{part.tail}
			</td>
		</>
	);
};

// Rows shown at most: the others are made too.
const SHOWN_AT_MOST = 300;

export const CleanupPanel: React.FC<CleanupPanelProps> = ({
	document,
	dialect,
	shown,
	selected,
	onEdit,
	onClose,
}) => {
	const entry = document.entries[selected];
	const [scope, setScope] = useState<Scope>(shown ? 'shown' : 'all');
	// Accents and capitals matter to BibTeX: biber reads Unicode, and
	// biblatex's styles keep a title's case.
	const [kinds, setKinds] = useState<Set<CleanupKind>>(
		() =>
			new Set(
				CLEANUP_KINDS.filter(
					(kind) =>
						dialect === 'bibtex' || (kind !== 'latex' && kind !== 'capitals'),
				),
			),
	);
	const [excluded, setExcluded] = useState<Set<string>>(new Set());
	const [done, setDone] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	const indices = useMemo((): number[] | undefined => {
		if (scope === 'entry') return entry ? [selected] : [];
		if (scope === 'shown') return shown ?? undefined;
		return undefined;
	}, [scope, entry, selected, shown]);
	// Each cleanup's count, all of them asked.
	const counts = useMemo(() => {
		const found: Partial<Record<CleanupKind, number>> = {};
		for (const change of cleanupChanges(
			document,
			new Set(CLEANUP_KINDS),
			indices,
		)) {
			for (const kind of change.kinds) found[kind] = (found[kind] ?? 0) + 1;
		}
		return found;
	}, [document, indices]);
	const changes = useMemo(
		() => cleanupChanges(document, kinds, indices),
		[document, kinds, indices],
	);
	const made = changes.filter((change) => !excluded.has(changeId(change)));

	const apply = () => {
		setError(null);
		// The entries, found again in the text as it is then.
		const targets = indices?.map((index) => ({
			key: document.entries[index]?.key ?? '',
			index,
		}));
		const left = new Set(excluded);
		const asked = new Set(kinds);
		try {
			onEdit((current) => {
				const fresh = parseBibDocument(current);
				const resolved = targets
					?.map((target) =>
						findEntryIndex(fresh.entries, target.key, target.index),
					)
					.filter((index) => index >= 0);
				return cleanupChanges(fresh, asked, resolved)
					.filter((change) => !left.has(changeId(change)))
					.map(({ from, to, insert }) => ({ from, to, insert }));
			});
			// What was left unchecked stays so.
			setDone(made.length);
		} catch (caught) {
			setError(editErrorMessage(caught));
		}
	};

	const chooseScope = (next: Scope) => {
		setDone(null);
		setScope(next);
	};
	const toggleChange = (id: string, on: boolean) => {
		setDone(null);
		setExcluded((current) => {
			const next = new Set(current);
			if (on) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleKind = (kind: CleanupKind, on: boolean) => {
		setDone(null);
		setKinds((current) => {
			const next = new Set(current);
			if (on) next.add(kind);
			else next.delete(kind);
			return next;
		});
	};

	return (
		<section
			className='bib-new-entry bib-cleanup'
			aria-label={t('Clean up the entries')}
			onKeyDown={(event) => {
				if (event.key === 'Escape') onClose();
			}}
		>
			<div className='bib-new-entry-header'>
				<h4>{t('Clean up the entries')}</h4>
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

			<fieldset className='bib-cleanup-scope'>
				<legend>{t('Which entries')}</legend>
				<label>
					<input
						type='radio'
						name='bib-cleanup-scope'
						checked={scope === 'all'}
						onChange={() => chooseScope('all')}
					/>
					{t('All ({number})', { number: document.entries.length })}
				</label>
				{shown && (
					<label>
						<input
							type='radio'
							name='bib-cleanup-scope'
							checked={scope === 'shown'}
							onChange={() => chooseScope('shown')}
						/>
						{t('Those shown ({number})', { number: shown.length })}
					</label>
				)}
				{entry && (
					<label>
						<input
							type='radio'
							name='bib-cleanup-scope'
							checked={scope === 'entry'}
							onChange={() => chooseScope('entry')}
						/>
						{t('This one')} <code>{entry.key}</code>
					</label>
				)}
			</fieldset>

			<fieldset className='bib-cleanup-kinds'>
				<legend>{t('Cleanups')}</legend>
				{CLEANUP_KINDS.map((kind) => (
					<label key={kind} title={TITLES[kind]?.()}>
						<input
							type='checkbox'
							checked={kinds.has(kind)}
							onChange={(event) => toggleKind(kind, event.target.checked)}
						/>
						<span>
							{LABELS[kind]()} <code>{EXAMPLES[kind]}</code>{' '}
							<span className='ui-meta'>
								({counts[kind] ?? 0})
								{NOTES[kind] ? ` · ${NOTES[kind]?.()}` : ''}
							</span>
						</span>
					</label>
				))}
			</fieldset>

			{changes.length > 0 ? (
				<div className='bib-cleanup-changes'>
					<table>
						<thead>
							<tr>
								<th scope='col'>
									<span className='ui-meta'>✓</span>
								</th>
								<th scope='col'>{t('Key')}</th>
								<th scope='col'>{t('Field')}</th>
								<th scope='col'>{t('Before')}</th>
								<th scope='col'>{t('After')}</th>
							</tr>
						</thead>
						<tbody>
							{changes.slice(0, SHOWN_AT_MOST).map((change) => {
								const id = changeId(change);
								return (
									<tr key={id} data-left={excluded.has(id) || undefined}>
										<td>
											<input
												type='checkbox'
												aria-label={t('Make this change')}
												checked={!excluded.has(id)}
												onChange={(event) =>
													toggleChange(id, event.target.checked)
												}
											/>
										</td>
										<td className='bib-cleanup-key'>{change.key}</td>
										<td className='bib-cleanup-field'>{change.field}</td>
										<Change change={change} />
									</tr>
								);
							})}
						</tbody>
					</table>
					{changes.length > SHOWN_AT_MOST && (
						<p className='ui-meta'>
							{t('And {number} other changes, made too', {
								number: changes.length - SHOWN_AT_MOST,
							})}
						</p>
					)}
				</div>
			) : (
				done === null && <p className='ui-meta'>{t('Nothing to clean up')}</p>
			)}
			{done !== null && (
				<p className='bib-rename-status ui-meta' role='status'>
					{t('{count} changes made: undo them in « Text » if need be', {
						count: done,
					})}
				</p>
			)}

			<div className='bib-new-entry-row bib-merge-actions'>
				<button
					type='button'
					className='button primary'
					disabled={made.length === 0}
					onClick={apply}
				>
					{t('Make {count} changes', { count: made.length })}
				</button>
				<button type='button' className='button' onClick={onClose}>
					{t('Close')}
				</button>
				{error && (
					<span className='bib-field-error' role='alert'>
						{error}
					</span>
				)}
			</div>
		</section>
	);
};

export default CleanupPanel;
