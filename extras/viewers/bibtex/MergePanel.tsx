// extras/viewers/bibtex/MergePanel.tsx
// Two entries that are probably the same work, side by side as JabRef's
// « Merge entries »: the key kept (that entry stays where it is, the other
// goes), the type, and for each field that differs, which value; with the
// preview of the result. The fields only one has are kept. The citations of
// the key that goes can be given the key kept.
import type React from 'react';
import { useId, useMemo, useState } from 'react';

import { CloseIcon } from '@/components/common/Icons';
import { t } from '@/i18n';
import {
	applyBibChanges,
	type BibDocument,
	type BibField,
	parseBibDocument,
} from '@/utils/bibDocument';
import { findEntryIndex, mergeChanges, mergeRows } from '@/utils/bibDuplicates';
import { previewEntry } from '@/utils/bibPreview';
import type { ProjectCitations } from '@/utils/latexCitations';
import { BibPreview, editErrorMessage } from './BibPreview';
import type { BibEdit } from './BibEntriesView';

/** An entry of the merge: its key, and where it was. */
export interface MergeSide {
	key: string;
	index: number;
}

export interface MergeResult {
	/** The key kept, and the index of its entry once the other is gone. */
	key: string;
	index: number;
	/** The key whose citations are to be given the key kept. */
	renameFrom?: string;
}

interface MergePanelProps {
	text: string;
	document: BibDocument;
	/** The entry shown first, then its probable duplicate. */
	sides: [MergeSide, MergeSide];
	citations?: ProjectCitations | null;
	canRenameCitations: boolean;
	onEdit: (edit: BibEdit) => void;
	onMerged: (result: MergeResult) => void;
	onClose: () => void;
}

// The entry shown first, then its duplicate.
const SIDES = [0, 1] as const;

const Value: React.FC<{ field: BibField | undefined }> = ({ field }) =>
	field ? (
		<code className='bib-merge-value'>{field.raw}</code>
	) : (
		<span className='ui-meta'>—</span>
	);

export const MergePanel: React.FC<MergePanelProps> = ({
	text,
	document,
	sides,
	citations,
	canRenameCitations,
	onEdit,
	onMerged,
	onClose,
}) => {
	const id = useId();
	const indices = sides.map((side) =>
		findEntryIndex(document.entries, side.key, side.index),
	) as [number, number];
	const entries = indices.map((index) => document.entries[index]);
	const [first, second] = entries;
	const usable =
		first !== undefined && second !== undefined && indices[0] !== indices[1];

	const cited = (key: string) => citations?.cited.get(key)?.count ?? 0;
	// The entry cited, if only one is; else the one shown.
	const [kept, setKept] = useState<0 | 1>(() =>
		cited(sides[1].key) > 0 && cited(sides[0].key) === 0 ? 1 : 0,
	);
	// Choices that differ from the kept entry's.
	const [picks, setPicks] = useState<Record<string, 0 | 1>>({});
	const [renameCited, setRenameCited] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const rows = useMemo(
		() => (usable ? mergeRows(first, second) : []),
		[usable, first, second],
	);
	const pick = (name: string): 0 | 1 => picks[name] ?? kept;
	const differing = rows.filter((row) => !row.agree);
	const typesDiffer =
		usable && first.type.toLowerCase() !== second.type.toLowerCase();
	const broken =
		usable &&
		entries.some((entry) => Boolean(entry.error) || entry.close === null);
	const annotated =
		usable &&
		entries.some((entry) => text.slice(entry.from, entry.to).includes('<###'));
	const locked = broken || annotated;

	const choice = () => {
		const other = kept === 0 ? 1 : 0;
		return {
			type: entries[pick('@type')].type,
			fromOther: new Set(
				differing
					.filter((row) => pick(row.name) === other)
					.map((row) => row.name),
			),
		};
	};

	// The result, from the two entries alone (macros read in the file).
	// biome-ignore lint/correctness/useExhaustiveDependencies: choice() reads picks and kept.
	const merged = useMemo(() => {
		if (!usable) return null;
		try {
			const keptEntry = entries[kept];
			const otherEntry = entries[kept === 0 ? 1 : 0];
			const pair = `${text.slice(keptEntry.from, keptEntry.to)}\n\n${text.slice(otherEntry.from, otherEntry.to)}\n`;
			const parsed = parseBibDocument(pair);
			const result = applyBibChanges(
				pair,
				mergeChanges(pair, parsed.entries[0], parsed.entries[1], choice()),
			);
			const resultDocument = {
				...parseBibDocument(result),
				strings: document.strings,
			};
			const entry = resultDocument.entries[0];
			return {
				source: result.slice(entry.from, entry.to),
				preview: previewEntry(resultDocument, entry),
			};
		} catch (caught) {
			return { source: '', preview: [], error: editErrorMessage(caught) };
		}
	}, [usable, text, document, first, second, kept, picks]);

	if (!usable) {
		return (
			<section className='bib-new-entry bib-merge'>
				<div className='bib-new-entry-header'>
					<h4>{t('Merge two entries')}</h4>
					<CloseButton onClose={onClose} />
				</div>
				<p className='ui-meta'>
					{t('These entries are no longer in the file')}
				</p>
			</section>
		);
	}

	const keptKey = entries[kept].key;
	const goneKey = entries[kept === 0 ? 1 : 0].key;
	const goneCited = goneKey !== keptKey ? cited(goneKey) : 0;

	const merge = () => {
		setError(null);
		const keptSide = { key: keptKey, index: indices[kept] };
		const goneSide = { key: goneKey, index: indices[kept === 0 ? 1 : 0] };
		const chosen = choice();
		try {
			onEdit((current) => {
				const fresh = parseBibDocument(current).entries;
				const keptIndex = findEntryIndex(fresh, keptSide.key, keptSide.index);
				let goneIndex = findEntryIndex(fresh, goneSide.key, goneSide.index);
				if (goneIndex === keptIndex) {
					// One key for both: the other one of them.
					goneIndex = fresh.findIndex(
						(entry, index) => index !== keptIndex && entry.key === goneSide.key,
					);
				}
				if (keptIndex < 0 || goneIndex < 0) return [];
				return mergeChanges(
					current,
					fresh[keptIndex],
					fresh[goneIndex],
					chosen,
				);
			});
		} catch (caught) {
			setError(editErrorMessage(caught));
			return;
		}
		onMerged({
			key: keptKey,
			index:
				goneSide.index < keptSide.index ? keptSide.index - 1 : keptSide.index,
			renameFrom:
				goneCited > 0 && canRenameCitations && renameCited
					? goneKey
					: undefined,
		});
	};

	const radio = (name: string, side: 0 | 1, label: React.ReactNode) => (
		<label className='bib-merge-choice'>
			<input
				type='radio'
				name={`${id}-${name}`}
				checked={name === '@key' ? kept === side : pick(name) === side}
				onChange={() => {
					if (name === '@key') {
						setKept(side);
						setPicks({});
					} else {
						setPicks((current) => ({ ...current, [name]: side }));
					}
				}}
			/>
			{label}
		</label>
	);

	return (
		<section
			className='bib-new-entry bib-merge'
			aria-label={t('Merge two entries')}
			onKeyDown={(event) => {
				if (event.key === 'Escape') onClose();
			}}
		>
			<div className='bib-new-entry-header'>
				<h4>{t('Merge two entries')}</h4>
				<CloseButton onClose={onClose} />
			</div>
			<p className='ui-meta'>
				{t(
					'The entry whose key is kept stays where it is, with the values chosen; the other one is deleted. Fields only one has are kept.',
				)}
			</p>

			<table className='bib-merge-table'>
				<thead>
					<tr>
						<th scope='col'>{t('Key kept')}</th>
						{SIDES.map((side) => (
							<th scope='col' key={side}>
								{radio('@key', side, <code>{entries[side].key}</code>)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{typesDiffer && (
						<tr data-differ>
							<th scope='row'>{t('Type')}</th>
							{SIDES.map((side) => (
								<td key={side}>
									{radio('@type', side, <code>@{entries[side].type}</code>)}
								</td>
							))}
						</tr>
					)}
					{rows.map((row) => (
						<tr key={row.name} data-differ={!row.agree || undefined}>
							<th scope='row'>
								{(row.fields[0] ?? row.fields[1])?.name.toLowerCase() ??
									row.name}
							</th>
							{SIDES.map((side) => (
								<td key={side}>
									{row.agree ? (
										<Value field={row.fields[side]} />
									) : (
										radio(row.name, side, <Value field={row.fields[side]} />)
									)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>

			{merged && (
				<div className='bib-preview'>
					{merged.error ? (
						<p className='bib-field-error' role='alert'>
							{merged.error}
						</p>
					) : (
						<BibPreview pieces={merged.preview} />
					)}
				</div>
			)}
			{merged?.source && (
				<details className='bib-source'>
					<summary>{t('Source')}</summary>
					<pre>{merged.source}</pre>
				</details>
			)}

			<div className='bib-new-entry-row bib-merge-actions'>
				{goneCited > 0 && canRenameCitations && (
					<label className='bib-rename-citations'>
						<input
							type='checkbox'
							checked={renameCited}
							onChange={(event) => setRenameCited(event.target.checked)}
						/>
						{t('Cite {kept} where {gone} is cited ({count} citations)', {
							kept: keptKey,
							gone: goneKey,
							count: goneCited,
						})}
					</label>
				)}
				<button
					type='button'
					className='button primary'
					disabled={locked || Boolean(merged?.error)}
					onClick={merge}
				>
					{t('Merge into {key}', { key: keptKey })}
				</button>
				<button type='button' className='button' onClick={onClose}>
					{t('Cancel')}
				</button>
				{locked && (
					<span className='bib-field-error' role='alert'>
						{broken
							? t('This entry cannot be read to its end: fix it in the text')
							: t(
									'This entry has comments or tracked changes: change it in the text',
								)}
					</span>
				)}
				{error && (
					<span className='bib-field-error' role='alert'>
						{error}
					</span>
				)}
			</div>
		</section>
	);
};

const CloseButton: React.FC<{ onClose: () => void }> = ({ onClose }) => (
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
);

export default MergePanel;
