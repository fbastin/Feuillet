// src/components/profile/AdminModal.tsx
// The administration page, as Overleaf Server's admin panel, for the
// accounts named in the server's ADMIN_ACCOUNTS: the server's state, its
// emails and its backups, its TeX Live servers (AdminCompile), who may
// create an account and the links to create one (AdminSignUps), every
// account, which may be deleted with the projects it owns, and the orphan
// projects, which may be deleted (AdminOrphans). It shows neither email addresses nor projects' names or
// contents, only how each account uses the server.
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import {
	AccountServerError,
	type AdminAccount,
	type AdminOverview,
	accountSyncService,
} from '../../services/AccountSyncService';
import { formatFileSize } from '../../utils/fileUtils';
import { RefreshIcon, SettingsIcon } from '../common/Icons';
import Modal from '../common/Modal';
import AdminCompile from './AdminCompile';
import AdminOrphans from './AdminOrphans';
import AdminSignUps from './AdminSignUps';

const DAY_MS = 24 * 60 * 60 * 1000;
// A backup each night: one older than this one was missed.
const STALE_MS = 26 * 60 * 60 * 1000;

type Sort = 'created' | 'used' | 'space' | 'name';

const dateOf = (time: number) =>
	new Date(time).toLocaleString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});

const dayOf = (time: number) =>
	new Date(time).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});

const sizeOf = (bytes: number | undefined) =>
	bytes && bytes > 0 ? formatFileSize(bytes) : '—';

const orderBy: Record<Sort, (a: AdminAccount, b: AdminAccount) => number> = {
	created: (a, b) => b.createdAt - a.createdAt,
	used: (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
	space: (a, b) => b.bytes - a.bytes,
	name: (a, b) => a.username.localeCompare(b.username),
};

interface AdminModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const AdminModal: React.FC<AdminModalProps> = ({ isOpen, onClose }) => {
	const [overview, setOverview] = useState<AdminOverview | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState('');
	const [sort, setSort] = useState<Sort>('created');
	const [confirming, setConfirming] = useState<AdminAccount | null>(null);
	const [typed, setTyped] = useState('');
	const [deleting, setDeleting] = useState(false);
	const [deleted, setDeleted] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			setOverview(await accountSyncService.adminOverview());
			setError(null);
		} catch (caught) {
			const code = caught instanceof AccountServerError ? caught.code : '';
			setError(
				code === 'not_admin'
					? t('This account does not administer the server any more.')
					: t('The server could not be reached. Please try again later.'),
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!isOpen) return;
		setDeleted(null);
		setConfirming(null);
		setTyped('');
		void load();
	}, [isOpen, load]);

	const accounts = useMemo(() => {
		const wanted = filter.trim().toLowerCase();
		return (overview?.accounts ?? [])
			.filter((account) => account.username.toLowerCase().includes(wanted))
			.sort(orderBy[sort]);
	}, [overview, filter, sort]);

	const askToDelete = (account: AdminAccount) => {
		setDeleted(null);
		setError(null);
		setTyped('');
		setConfirming(account);
	};

	const remove = async () => {
		if (!confirming || typed !== confirming.username) return;
		setDeleting(true);
		setError(null);
		try {
			await accountSyncService.adminDeleteAccount(
				confirming.id,
				confirming.username,
			);
			setDeleted(confirming.username);
			setConfirming(null);
			setTyped('');
			await load();
		} catch (caught) {
			const code = caught instanceof AccountServerError ? caught.code : '';
			if (code === 'wrong_username' || code === 'unknown_account') {
				setError(
					t('This account changed in the meantime; here is the list again.'),
				);
				setConfirming(null);
				void load();
			} else {
				setError(
					code === 'admin_account'
						? t("An administrator's account cannot be deleted here.")
						: t('The account could not be deleted. Please try again later.'),
				);
			}
		} finally {
			setDeleting(false);
		}
	};

	const server = overview?.server;
	const mail = overview?.mail;
	const backup = overview?.backup;
	const last = backup?.last;
	const now = Date.now();

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={t('Administration')}
			size='large'
			icon={SettingsIcon}
		>
			<div className='ui-stack admin-page' data-gap='md' data-role='admin-page'>
				{error && (
					<div className='ui-message' data-tone='error' data-role='admin-error'>
						{error}
					</div>
				)}
				{deleted && (
					<div
						className='ui-message'
						data-tone='success'
						data-role='admin-deleted'
					>
						{t(
							'The account {username} was deleted, with the projects it owned.',
							{
								username: deleted,
							},
						)}
					</div>
				)}
				{!overview && loading && <p className='ui-meta'>{t('Loading...')}</p>}

				{overview && server && (
					<>
						<div className='admin-cards'>
							<section className='admin-card' data-role='admin-server'>
								<h3>{t('Server')}</h3>
								<dl>
									<dt>{t('Running since')}</dt>
									<dd>{dateOf(server.startedAt)}</dd>
									<dt>{t('Open documents')}</dt>
									<dd>{server.documents}</dd>
									<dt>{t('Connections')}</dt>
									<dd>{server.connections}</dd>
									<dt>{t('Projects')}</dt>
									<dd>{server.projects}</dd>
									{server.unowned > 0 && (
										<>
											<dt>{t('Without an owner')}</dt>
											<dd>{server.unowned}</dd>
										</>
									)}
								</dl>
							</section>

							<section className='admin-card' data-role='admin-disk'>
								<h3>{t('Disk')}</h3>
								<dl>
									<dt>{t('Documents')}</dt>
									<dd>{sizeOf(server.disk.documents)}</dd>
									<dt>{t('Files')}</dt>
									<dd>{sizeOf(server.disk.files)}</dd>
									<dt>{t('Versions')}</dt>
									<dd>{sizeOf(server.disk.versions)}</dd>
									<dt>{t('Accounts')}</dt>
									<dd>{sizeOf(server.disk.accounts)}</dd>
									{server.disk.git !== undefined && (
										<>
											<dt>{t('Git repositories')}</dt>
											<dd>{sizeOf(server.disk.git)}</dd>
										</>
									)}
									{server.disk.free !== undefined && (
										<>
											<dt>{t('Free space')}</dt>
											<dd>{sizeOf(server.disk.free)}</dd>
										</>
									)}
								</dl>
							</section>

							<section className='admin-card' data-role='admin-mail'>
								<h3>{t('Emails')}</h3>
								{mail ? (
									<>
										<dl>
											<dt>{t('Sent in the last 24 hours')}</dt>
											<dd data-role='admin-mail-sent'>
												{t('{used} of {total}', {
													used: mail.sent,
													total: mail.limit,
												})}
											</dd>
											<dt>{t('Invitations, at most')}</dt>
											<dd>{mail.invitationLimit}</dd>
										</dl>
										{mail.sent >= mail.invitationLimit && (
											<div className='ui-message' data-tone='warning'>
												{mail.sent >= mail.limit
													? t(
															'The limit is reached: no email goes until older ones are more than 24 hours old.',
														)
													: t(
															'Invitations are no longer mailed until older emails are more than 24 hours old.',
														)}
											</div>
										)}
										{now - mail.since < DAY_MS && (
											<p className='ui-meta'>
												{t('Counted since the server started.')}
											</p>
										)}
									</>
								) : (
									<p data-role='admin-mail-off'>
										{t(
											'The server sends no email: SMTP_URL and MAIL_FROM, in /etc/feuillet/collab.env, turn them on.',
										)}
									</p>
								)}
							</section>

							<section className='admin-card' data-role='admin-backup'>
								<h3>{t('Backups')}</h3>
								{!backup && (
									<p data-role='admin-backup-none'>
										{t(
											'No backup has been made yet. deploy/install.sh sets them up, each night at 4:30.',
										)}
									</p>
								)}
								{backup?.failed && (
									<div
										className='ui-message'
										data-tone='error'
										data-role='admin-backup-failed'
									>
										{t('The backup of {date} failed: {error}', {
											date: dateOf(backup.failed.time),
											error: backup.failed.error,
										})}
									</div>
								)}
								{last && (
									<dl>
										<dt>{t('Last backup')}</dt>
										<dd data-role='admin-backup-last'>{dateOf(last.time)}</dd>
										<dt>{t('Size')}</dt>
										<dd>{sizeOf(last.bytes)}</dd>
										<dt>{t('Kept')}</dt>
										<dd>{last.kept}</dd>
									</dl>
								)}
								{last && !backup?.failed && now - last.time > STALE_MS && (
									<div
										className='ui-message'
										data-tone='warning'
										data-role='admin-backup-stale'
									>
										{t(
											'The last backup is more than a day old: see /var/log/feuillet-backup.log.',
										)}
									</div>
								)}
								{last?.copy === 'none' && (
									<div
										className='ui-message'
										data-tone='warning'
										data-role='admin-backup-local'
									>
										{t(
											'The backups stay on this machine: a failing disk would take them with the server. BACKUP_COPY_TO copies them elsewhere (deploy/README.md).',
										)}
									</div>
								)}
								{last?.copy === 'failed' && (
									<div className='ui-message' data-tone='error'>
										{t(
											'The last copy off this machine failed: see /var/log/feuillet-backup.log.',
										)}
									</div>
								)}
								{last?.copy === 'done' && (
									<p className='ui-meta'>
										{t('Each one is also copied off this machine.')}
									</p>
								)}
							</section>

							<AdminCompile
								compile={overview.compile}
								grammar={overview.grammar}
							/>
						</div>

						<AdminSignUps dayOf={dayOf} />

						<section
							className='ui-stack'
							data-gap='sm'
							data-role='admin-accounts'
						>
							<div className='ui-toolbar admin-toolbar' data-justify='between'>
								<h3>
									{t('Accounts')}{' '}
									<span
										className='ui-badge'
										data-variant='label'
										data-role='admin-account-count'
									>
										{overview.accounts.length}
									</span>
								</h3>
								<div className='ui-toolbar'>
									<input
										id='admin-filter'
										type='search'
										value={filter}
										placeholder={t('Search by name')}
										aria-label={t('Search by name')}
										onChange={(event) => setFilter(event.target.value)}
									/>
									<select
										id='admin-sort'
										value={sort}
										aria-label={t('Sort by')}
										onChange={(event) => setSort(event.target.value as Sort)}
									>
										<option value='created'>{t('Newest first')}</option>
										<option value='used'>{t('Last used first')}</option>
										<option value='space'>{t('Largest first')}</option>
										<option value='name'>{t('By name')}</option>
									</select>
									<button
										type='button'
										className='button secondary'
										data-action='admin-refresh'
										disabled={loading}
										aria-busy={loading}
										title={t('Refresh')}
										onClick={() => void load()}
									>
										<RefreshIcon />
									</button>
								</div>
							</div>

							<div className='admin-table'>
								<table className='admin-accounts'>
									<thead>
										<tr>
											<th>{t('Account')}</th>
											<th>{t('Created')}</th>
											<th>{t('Last used')}</th>
											<th data-align='end'>{t('Devices')}</th>
											<th data-align='end'>{t('Projects owned')}</th>
											<th data-align='end'>{t('Member of')}</th>
											<th data-align='end'>{t('Space')}</th>
											<th>{t('Email')}</th>
											<th>{t('Two-factor')}</th>
											<th aria-label={t('Actions')} />
										</tr>
									</thead>
									<tbody>
										{accounts.map((account) => {
											const you = account.id === overview.you;
											return (
												<tr key={account.id} data-account={account.username}>
													<td>
														<strong>{account.username}</strong>
														{you && (
															<span
																className='ui-badge'
																data-variant='label'
																data-tone='accent'
																data-role='admin-you'
															>
																{t('You')}
															</span>
														)}
														{account.admin && (
															<span
																className='ui-badge'
																data-variant='label'
																data-role='admin-badge'
															>
																{t('Administrator')}
															</span>
														)}
													</td>
													<td>{dayOf(account.createdAt)}</td>
													<td>
														{account.lastUsedAt
															? dayOf(account.lastUsedAt)
															: '—'}
													</td>
													<td data-align='end'>{account.devices}</td>
													<td data-align='end' data-role='admin-owned'>
														{account.owned}
													</td>
													<td data-align='end'>{account.memberOf}</td>
													<td data-align='end' data-role='admin-space'>
														{sizeOf(account.bytes)}
													</td>
													<td data-role='admin-email'>
														{account.email === 'confirmed'
															? t('Confirmed')
															: account.email === 'pending'
																? t('To confirm')
																: '—'}
													</td>
													<td data-role='admin-two-factor'>
														{account.twoFactor ? t('On') : '—'}
													</td>
													<td data-align='end'>
														{!you && !account.admin && (
															<button
																type='button'
																className='button danger'
																data-action='admin-delete-account'
																disabled={deleting}
																onClick={() => askToDelete(account)}
															>
																{t('Delete')}
															</button>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
								{accounts.length === 0 && (
									<p className='ui-meta'>{t('No account has this name.')}</p>
								)}
							</div>

							{confirming && (
								<div
									className='ui-message ui-stack'
									data-tone='error'
									data-gap='sm'
									data-role='admin-confirm-delete'
								>
									<p>
										{t(
											'Deleting the account {username} erases it from the server with the projects it owns ({owned}), their files and versions, for their collaborators too; it leaves the projects of others. This cannot be undone: only the backups keep it, two weeks at most.',
											{
												username: confirming.username,
												owned: confirming.owned,
											},
										)}
									</p>
									<label htmlFor='admin-delete-name'>
										{t('To confirm, type the name of the account:')}
									</label>
									<input
										id='admin-delete-name'
										type='text'
										autoComplete='off'
										spellCheck={false}
										value={typed}
										onChange={(event) => setTyped(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === 'Enter') void remove();
										}}
									/>
									<div className='ui-actions' data-align='end'>
										<button
											type='button'
											className='button secondary'
											data-action='admin-delete-cancel'
											disabled={deleting}
											onClick={() => setConfirming(null)}
										>
											{t('Cancel')}
										</button>
										<button
											type='button'
											className='button danger'
											data-action='admin-delete-confirm'
											disabled={deleting || typed !== confirming.username}
											aria-busy={deleting}
											onClick={() => void remove()}
										>
											{t('Delete for good')}
										</button>
									</div>
								</div>
							)}
						</section>

						<AdminOrphans
							orphans={overview.orphans}
							dayOf={dayOf}
							onChanged={load}
						/>

						<p className='ui-meta'>
							{t(
								'This page shows neither the email addresses nor the projects: only how each account uses the server.',
							)}
						</p>
					</>
				)}
			</div>
		</Modal>
	);
};

export default AdminModal;
