// src/components/profile/ProfileRecoveryEmailSection.tsx
// The account's email address, as on Overleaf: a link mailed to it
// confirms it; a forgotten password then sends a link there. The server
// keeps it; the browser's copy follows it. Shown only when the server sends
// mail.
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import i18next, { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../hooks/useSettings';
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
		return t('This address is already the email address of another account.');
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
	const { user, isGuestUser, updateUser } = useAuth();
	const { getSetting, updateSetting } = useSettings();
	// Emails about the review, sent to the confirmed address (on by default).
	const reviewEmails = getSetting('review-email-notifications')?.value !== false;
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [email, setEmail] = useState<RecoveryEmailStatus | null>(null);
	const [address, setAddress] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const prefilled = useRef(false);

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

	// The browser's copy follows the server's address, set on any device.
	useEffect(() => {
		if (!user || !email?.enabled || !email.address) return;
		if (user.email !== email.address) {
			void updateUser({ ...user, email: email.address });
		}
	}, [user, email, updateUser]);

	// An address given here before the server kept one, as when signing up
	// before recovery by email: offered, to confirm it.
	const unconfirmed =
		email?.enabled && !email.address && !email.pending && user?.email
			? user.email
			: null;
	useEffect(() => {
		if (unconfirmed && !prefilled.current) {
			prefilled.current = true;
			setAddress(unconfirmed);
		}
	}, [unconfirmed]);

	if (!user || isGuestUser(user) || !linked || !email?.enabled) return null;

	const change = async (next: string | null) => {
		setNotice(null);
		// The address it already has, confirmed: the server sends nothing.
		if (
			next !== null &&
			email.address &&
			next.toLowerCase() === email.address.toLowerCase()
		) {
			setError(null);
			setNotice(
				t(
					'{address} is already your confirmed address: there is no link to send.',
					{ address: email.address },
				),
			);
			return;
		}
		if (!password) {
			setError(t('Enter your password to change your email address.'));
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
			if (updated) {
				setEmail(updated);
				if (next === null) await updateUser({ ...user, email: undefined });
			}
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
			<h3>{t('Account email')}</h3>
			<p>
				{t(
					'If you forget your password, Feuillet sends a link to this address to choose a new one; a first link confirms it. It is never shown to anyone, nor written in your Git commits.',
				)}
			</p>

			<p className='ui-meta' data-role='recovery-email-status'>
				{email.address
					? t('Your email address is {address}; it is confirmed.', {
							address: email.address,
						})
					: unconfirmed
						? t(
								'{address} is not confirmed yet: confirm it to recover your account if you forget your password.',
								{ address: unconfirmed },
							)
						: t('Your account has no email address.')}
			</p>
			<label className='checkbox-control' data-role='review-emails'>
				<input
					type='checkbox'
					checked={reviewEmails}
					onChange={(event) =>
						updateSetting('review-email-notifications', event.target.checked)
					}
				/>
				<span>
					{t(
						'Review emails: tell me when someone replies in a comment thread of mine, or mentions me (@name)',
					)}
				</span>
			</label>
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
			{notice && (
				<div
					className='ui-message'
					data-tone='info'
					data-role='recovery-email-notice'
				>
					{notice}
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
						{email.address ? t('New email address') : t('Email address')}
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
