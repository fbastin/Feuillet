// src/components/profile/ProfileRecoveryEmailSection.tsx
// The address the account may be recovered with, as on Overleaf: a link
// mailed to it confirms it; a forgotten password then sends a link there.
// Shown only when the server sends mail.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import i18next, { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	AccountServerError,
	type AccountSyncStatus,
	type RecoveryEmailStatus,
	accountSyncService,
} from '../../services/AccountSyncService';

const errorMessage = (error: unknown): string => {
	const code = error instanceof AccountServerError ? error.code : '';
	if (code === 'wrong_password') return t('Invalid password');
	if (code === 'invalid_email') return t('Enter a valid email address.');
	if (code === 'email_taken') {
		return t('This address already recovers another account.');
	}
	if (code === 'too_many_attempts') {
		return t('Too many attempts. Please try again in a few minutes.');
	}
	if (code === 'mail_failed') {
		return t('The email could not be sent. Please try again later.');
	}
	return t('The server could not be reached. Please try again later.');
};

const ProfileRecoveryEmailSection: React.FC = () => {
	const { user, isGuestUser } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [email, setEmail] = useState<RecoveryEmailStatus | null>(null);
	const [address, setAddress] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => accountSyncService.addListener(setStatus), []);
	const linked = status.state !== 'signed-out' && accountSyncService.isLinked();

	const load = useCallback(async () => {
		try {
			setEmail(await accountSyncService.recoveryEmail());
		} catch {
			setEmail(null);
		}
	}, []);

	useEffect(() => {
		if (linked) void load();
	}, [linked, load]);

	if (!user || isGuestUser(user) || !linked || !email?.enabled) return null;

	const change = async (next: string | null) => {
		if (!password) {
			setError(t('Enter your password to change the recovery address.'));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const updated = await accountSyncService.setRecoveryEmail(
				next,
				password,
				i18next.language,
			);
			if (updated) setEmail(updated);
			setPassword('');
			setAddress('');
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='ui-stack recovery-section' data-gap='sm'>
			<h3>{t('Recovery email')}</h3>
			<p>
				{t(
					'If you forget your password, Feuillet can send a link to this address to choose a new one. It serves only for that, and is never shown to anyone.',
				)}
			</p>

			<p className='ui-meta' data-role='recovery-email-status'>
				{email.address
					? t('Your recovery address is {address}.', { address: email.address })
					: t('Your account has no recovery address.')}
			</p>
			{email.pending && (
				<div
					className='ui-message'
					data-tone='info'
					data-role='recovery-email-pending'
				>
					{t(
						'A link was sent to {address}: open it to confirm the address. It works for 24 hours.',
						{ address: email.pending },
					)}
				</div>
			)}

			{error && (
				<div className='ui-message' data-tone='error'>
					{error}
				</div>
			)}

			<form
				className='ui-stack'
				data-gap='xs'
				onSubmit={(event) => {
					event.preventDefault();
					void change(address.trim());
				}}
			>
				<div className='ui-field'>
					<label htmlFor='recovery-email'>
						{email.address ? t('New recovery address') : t('Recovery address')}
					</label>
					<input
						type='email'
						id='recovery-email'
						value={address}
						onChange={(event) => setAddress(event.target.value)}
						autoComplete='email'
						disabled={busy}
					/>
				</div>
				<div className='ui-field'>
					<label htmlFor='recovery-email-password'>{t('Your password')}</label>
					<input
						type='password'
						id='recovery-email-password'
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						autoComplete='current-password'
						disabled={busy}
					/>
				</div>
				{/* Pico widens submit buttons: both share the row. */}
				<div className='ui-actions' data-align='end' data-fill='true'>
					{email.address && (
						<button
							type='button'
							className='button secondary'
							data-action='remove-recovery-email'
							disabled={busy}
							onClick={() => void change(null)}
						>
							{t('Remove the address')}
						</button>
					)}
					<button
						type='submit'
						className='button primary'
						data-action='set-recovery-email'
						data-state={busy ? 'loading' : undefined}
						disabled={busy || !address.trim()}
					>
						{/* Sending may take some seconds. */}
						{busy ? t('Sending the link…') : t('Send the confirmation link')}
					</button>
				</div>
			</form>
		</div>
	);
};

export default ProfileRecoveryEmailSection;
