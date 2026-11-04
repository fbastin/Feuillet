// src/components/profile/ProfileGoogleSection.tsx
// Signing in with Google, as on Overleaf: the account may be linked to a
// Google account, which then signs in to it on any device; or not any more.
// Of the Google account, the server keeps only what recognizes it, never its
// address nor its name. Shown only when the server signs in with Google.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import i18next, { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	AccountServerError,
	type AccountSyncStatus,
	type GoogleStatus,
	accountSyncService,
} from '../../services/AccountSyncService';
import GoogleSignInButton from '../auth/GoogleSignInButton';

const errorMessage = (error: unknown): string => {
	const code = error instanceof AccountServerError ? error.code : '';
	if (code === 'wrong_password') return t('Invalid password');
	if (code === 'google_taken') {
		return t(
			'This Google account is already linked to another Feuillet account.',
		);
	}
	if (code === 'invalid_ticket') {
		return t(
			'The confirmation from Google expired. Sign in with Google again.',
		);
	}
	if (code === 'too_many_attempts') {
		return t('Too many attempts. Please try again in a few minutes.');
	}
	return t('The server could not be reached. Please try again later.');
};

const ProfileGoogleSection: React.FC = () => {
	const { user, isGuestUser } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [google, setGoogle] = useState<GoogleStatus | null>(null);
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => accountSyncService.addListener(setStatus), []);
	const linked = status.state !== 'signed-out' && accountSyncService.isLinked();

	const load = useCallback(async () => {
		try {
			setGoogle(await accountSyncService.googleStatus());
		} catch {
			setGoogle(null);
		}
	}, []);

	useEffect(() => {
		if (linked) void load();
	}, [linked, load]);

	if (!user || isGuestUser(user) || !linked || !google?.enabled) return null;

	const needPassword = (): boolean => {
		setNotice(null);
		if (password) {
			setError(null);
			return true;
		}
		setError(t('Enter your password to change how you sign in with Google.'));
		return false;
	};

	const change = async (ticket: string | null) => {
		setBusy(true);
		setError(null);
		try {
			const updated = await accountSyncService.setGoogle(ticket, password);
			if (updated) setGoogle(updated);
			setPassword('');
			setNotice(
				ticket === null
					? t('Google no longer signs in to your account.')
					: t('Google now signs you in to your account, on any device.'),
			);
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	const since = google.linkedAt
		? new Date(google.linkedAt).toLocaleDateString(i18next.language, {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			})
		: '';

	return (
		<div
			className='ui-stack recovery-section'
			data-gap='sm'
			data-role='profile-google'
		>
			<h3>{t('Sign in with Google')}</h3>
			<p>
				{t(
					'Link a Google account to sign in with it, as on Overleaf. Feuillet keeps only what recognizes that account, neither its address nor its name; your password still opens your account.',
				)}
			</p>
			<p className='ui-meta' data-role='google-status'>
				{google.linked
					? t('Your account is linked to a Google account since {date}.', {
							date: since,
						})
					: t('Your account is not linked to a Google account.')}
			</p>

			{error && (
				<div className='ui-message' data-tone='error'>
					{error}
				</div>
			)}
			{notice && (
				<div
					className='ui-message'
					data-tone='success'
					data-role='google-notice'
				>
					{notice}
				</div>
			)}

			<div className='ui-field'>
				<label htmlFor='google-password'>{t('Your password')}</label>
				<input
					type='password'
					id='google-password'
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					autoComplete='current-password'
					disabled={busy}
				/>
			</div>
			<div className='ui-actions' data-align='end' data-wrap='true'>
				{google.linked && (
					<button
						type='button'
						className='button secondary'
						data-action='unlink-google'
						disabled={busy}
						onClick={() => {
							if (needPassword()) void change(null);
						}}
					>
						{t('Unlink Google')}
					</button>
				)}
				<GoogleSignInButton
					variant='inline'
					label={
						google.linked
							? t('Link another Google account')
							: t('Link a Google account')
					}
					disabled={busy}
					canStart={needPassword}
					onTicket={change}
					onError={setError}
				/>
			</div>
		</div>
	);
};

export default ProfileGoogleSection;
