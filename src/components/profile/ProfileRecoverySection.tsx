// src/components/profile/ProfileRecoverySection.tsx
// Recovery codes, as GitHub's, for a forgotten password: Feuillet keeps no
// email address. Each code opens the account once, from the sign-in page,
// to choose a new password. They are shown only when made.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	AccountServerError,
	type AccountSyncStatus,
	accountSyncService,
} from '../../services/AccountSyncService';
import ServerAccountLinkForm from './ServerAccountLinkForm';

const dateOf = (time: number) =>
	new Date(time).toLocaleDateString(undefined, { dateStyle: 'long' });

const ProfileRecoverySection: React.FC = () => {
	const { user, isGuestUser } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [recovery, setRecovery] = useState<{
		count: number;
		createdAt?: number;
	} | null>(null);
	const [password, setPassword] = useState('');
	const [codes, setCodes] = useState<string[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => accountSyncService.addListener(setStatus), []);
	const linked = status.state !== 'signed-out' && accountSyncService.isLinked();

	const load = useCallback(async () => {
		try {
			setRecovery(await accountSyncService.recoveryStatus());
		} catch {
			setRecovery(null);
		}
	}, []);

	useEffect(() => {
		if (linked) void load();
	}, [linked, load]);

	if (!user || isGuestUser(user)) return null;

	const create = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!password) return;
		setBusy(true);
		setError(null);
		setCopied(false);
		try {
			const made = await accountSyncService.createRecoveryCodes(password);
			if (made) {
				setCodes(made.codes);
				setRecovery({ count: made.codes.length, createdAt: made.createdAt });
			}
			setPassword('');
		} catch (caught) {
			const code = caught instanceof AccountServerError ? caught.code : '';
			setError(
				code === 'wrong_password'
					? t('Invalid password')
					: code === 'not_found'
						? t('The server does not offer recovery codes yet.')
						: t('The server could not be reached. Please try again later.'),
			);
		} finally {
			setBusy(false);
		}
	};

	const text = () =>
		[
			t('Feuillet recovery codes for {username}', {
				username: user.username,
			}),
			t(
				'Each code works once, to choose a new password from the sign-in page.',
			),
			'',
			...(codes ?? []),
		].join('\n');

	const copy = async () => {
		await navigator.clipboard.writeText(text());
		setCopied(true);
	};

	const download = () => {
		const url = URL.createObjectURL(
			new Blob([`${text()}\n`], { type: 'text/plain' }),
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = `feuillet-recovery-codes-${user.username}.txt`;
		link.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className='ui-stack recovery-section' data-gap='sm'>
			<h3>{t('Recovery codes')}</h3>
			<p>
				{t(
					'If you forget your password, a recovery code lets you choose a new one from the sign-in page. Feuillet keeps no email address to send you a link. Each code works once.',
				)}
			</p>

			{!linked ? (
				<ServerAccountLinkForm
					reason={t('Recovery codes are kept by your account on the server.')}
					onLinked={() => setStatus(accountSyncService.getStatus())}
				/>
			) : (
				<>
					{recovery && (
						<p className='ui-meta' data-role='recovery-status'>
							{recovery.count === 0
								? t('Your account has no recovery codes.')
								: t('{count} codes left, made on {date}.', {
										count: recovery.count,
										date: recovery.createdAt ? dateOf(recovery.createdAt) : '',
									})}
						</p>
					)}

					{codes && codes.length > 0 && (
						<div
							className='ui-message ui-stack'
							data-tone='warning'
							data-gap='xs'
						>
							<strong>
								{t(
									'Keep these codes somewhere safe, such as a password manager. They will not be shown again.',
								)}
							</strong>
							<ol className='recovery-codes' data-role='recovery-codes'>
								{codes.map((code) => (
									<li key={code}>
										<code>{code}</code>
									</li>
								))}
							</ol>
							<div className='ui-actions'>
								<button
									type='button'
									className='button secondary'
									data-action='copy-recovery-codes'
									onClick={() => void copy()}
								>
									{copied ? t('Copied') : t('Copy')}
								</button>
								<button
									type='button'
									className='button secondary'
									data-action='download-recovery-codes'
									onClick={download}
								>
									{t('Download')}
								</button>
							</div>
						</div>
					)}

					{error && (
						<div className='ui-message' data-tone='error'>
							{error}
						</div>
					)}

					<form className='ui-stack' data-gap='xs' onSubmit={create}>
						<div className='ui-field'>
							<label htmlFor='recovery-password'>
								{t('Your password, to make new codes')}
							</label>
							<input
								type='password'
								id='recovery-password'
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								autoComplete='current-password'
								disabled={busy}
							/>
						</div>
						<div className='ui-actions' data-align='end'>
							<button
								type='submit'
								className='button primary'
								data-action='create-recovery-codes'
								disabled={busy || !password}
							>
								{recovery && recovery.count > 0
									? t('Replace the recovery codes')
									: t('Make recovery codes')}
							</button>
						</div>
						{recovery && recovery.count > 0 && (
							<p className='ui-meta'>
								{t(
									'New codes replace those you have: the old ones stop working.',
								)}
							</p>
						)}
					</form>
				</>
			)}
		</div>
	);
};

export default ProfileRecoverySection;
