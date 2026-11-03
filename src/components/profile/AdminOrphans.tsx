// src/components/profile/AdminOrphans.tsx
// The administration page's orphan projects: those no one can find any
// more (no account owns or lists them, their owner's account was deleted,
// or they were deleted but their contents remain), which the administrator
// may delete for good. Each shows under a key, never its id or its name.
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import {
	type AdminOrphan,
	accountSyncService,
} from '../../services/AccountSyncService';
import { formatFileSize } from '../../utils/fileUtils';

const reasonOf = (reason: AdminOrphan['reason']) =>
	reason === 'gone'
		? t("Its owner's account was deleted")
		: reason === 'unlisted'
			? t("On no list, not even its owner's")
			: reason === 'deleted'
				? t('Deleted, but its contents remain')
				: t('No owner, on no list');

interface AdminOrphansProps {
	orphans: AdminOrphan[];
	dayOf: (time: number) => string;
	/** Asks the server for the page again. */
	onChanged: () => Promise<void>;
}

const AdminOrphans: React.FC<AdminOrphansProps> = ({
	orphans,
	dayOf,
	onChanged,
}) => {
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [confirming, setConfirming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [done, setDone] = useState<{ deleted: number; skipped: number }>();
	const [error, setError] = useState<string | null>(null);

	// The longest unchanged first.
	const sorted = useMemo(
		() => [...orphans].sort((a, b) => (a.changedAt ?? 0) - (b.changedAt ?? 0)),
		[orphans],
	);

	// Only those still listed stay selected.
	useEffect(() => {
		setSelected((current) => {
			const keys = new Set(orphans.map((orphan) => orphan.key));
			const kept = new Set([...current].filter((key) => keys.has(key)));
			return kept.size === current.size ? current : kept;
		});
	}, [orphans]);

	const chosen = sorted.filter((orphan) => selected.has(orphan.key));
	const openChosen = chosen.filter((orphan) => orphan.open).length;
	const total = orphans.reduce((sum, orphan) => sum + orphan.bytes, 0);
	const all = orphans.length > 0 && selected.size === orphans.length;

	const toggle = (key: string) => {
		setConfirming(false);
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const toggleAll = () => {
		setConfirming(false);
		setSelected(all ? new Set() : new Set(orphans.map((orphan) => orphan.key)));
	};

	const remove = async () => {
		if (chosen.length === 0) return;
		setDeleting(true);
		setError(null);
		setDone(undefined);
		try {
			setDone(
				await accountSyncService.adminDeleteProjects(
					chosen.map((orphan) => orphan.key),
				),
			);
			setSelected(new Set());
			setConfirming(false);
			await onChanged();
		} catch {
			setError(t('The projects could not be deleted. Please try again later.'));
		} finally {
			setDeleting(false);
		}
	};

	return (
		<section className='ui-stack' data-gap='sm' data-role='admin-orphans'>
			<div className='ui-toolbar admin-toolbar' data-justify='between'>
				<h3>
					{t('Orphan projects')}{' '}
					<span
						className='ui-badge'
						data-variant='label'
						data-role='admin-orphan-count'
					>
						{orphans.length}
					</span>{' '}
					{total > 0 && (
						<span className='ui-meta' data-role='admin-orphan-space'>
							{formatFileSize(total)}
						</span>
					)}
				</h3>
				{orphans.length > 0 && (
					<button
						type='button'
						className='button danger'
						data-action='admin-delete-orphans'
						disabled={chosen.length === 0 || deleting}
						onClick={() => {
							setDone(undefined);
							setError(null);
							setConfirming(true);
						}}
					>
						{t('Delete selected ({number})', { number: chosen.length })}
					</button>
				)}
			</div>
			<p className='ui-meta'>
				{t(
					"Projects no one can find any more: no account owns or lists them, their owner's account was deleted, or they were deleted but their contents remain. Projects made without an account on the server, a guest's for one, are among them: when they last changed and whether they are open tell whether someone still uses them.",
				)}
			</p>

			{done && (
				<div
					className='ui-message'
					data-tone='success'
					data-role='admin-orphans-deleted'
				>
					{t('{count} projects were deleted for good.', {
						count: done.deleted,
					})}
					{done.skipped > 0 &&
						` ${t('{count} projects were no longer orphans and stayed.', {
							count: done.skipped,
						})}`}
				</div>
			)}
			{error && (
				<div className='ui-message' data-tone='error'>
					{error}
				</div>
			)}

			{orphans.length === 0 ? (
				<p data-role='admin-no-orphans'>{t('No orphan project.')}</p>
			) : (
				<div className='admin-table'>
					<table className='admin-orphans'>
						<thead>
							<tr>
								<th>
									<input
										type='checkbox'
										data-action='admin-select-orphans'
										checked={all}
										aria-label={t('Select all')}
										onChange={toggleAll}
									/>
								</th>
								<th>{t('Project')}</th>
								<th>{t('Why')}</th>
								<th>{t('Last change')}</th>
								<th data-align='end'>{t('Members')}</th>
								<th data-align='end'>{t('Space')}</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((orphan) => (
								<tr
									key={orphan.key}
									data-orphan={orphan.key}
									data-reason={orphan.reason}
								>
									<td>
										<input
											type='checkbox'
											checked={selected.has(orphan.key)}
											aria-label={t('Select project {key}', {
												key: orphan.key.slice(0, 8),
											})}
											onChange={() => toggle(orphan.key)}
										/>
									</td>
									<td>
										<code>{orphan.key.slice(0, 8)}</code>
										{orphan.open && (
											<span
												className='ui-badge'
												data-variant='label'
												data-tone='accent'
												data-role='admin-orphan-open'
											>
												{t('Open now')}
											</span>
										)}
									</td>
									<td>{reasonOf(orphan.reason)}</td>
									<td>{orphan.changedAt ? dayOf(orphan.changedAt) : '—'}</td>
									<td data-align='end'>{orphan.members || '—'}</td>
									<td data-align='end'>
										{orphan.bytes > 0 ? formatFileSize(orphan.bytes) : '—'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{confirming && chosen.length > 0 && (
				<div
					className='ui-message ui-stack'
					data-tone='error'
					data-gap='sm'
					data-role='admin-confirm-orphans'
				>
					<p>
						{t(
							'Delete {count} projects for good? Their documents, files and versions are erased from the server, and none of their links opens them again. This cannot be undone: only the backups keep them, two weeks at most.',
							{ count: chosen.length },
						)}
					</p>
					{openChosen > 0 && (
						<p data-role='admin-confirm-open'>
							{t(
								'{count} of them are open right now: whoever has them open is cut off.',
								{ count: openChosen },
							)}
						</p>
					)}
					<div className='ui-actions' data-align='end'>
						<button
							type='button'
							className='button secondary'
							data-action='admin-orphans-cancel'
							disabled={deleting}
							onClick={() => setConfirming(false)}
						>
							{t('Cancel')}
						</button>
						<button
							type='button'
							className='button danger'
							data-action='admin-orphans-confirm'
							disabled={deleting}
							aria-busy={deleting}
							onClick={() => void remove()}
						>
							{t('Delete for good')}
						</button>
					</div>
				</div>
			)}
		</section>
	);
};

export default AdminOrphans;
