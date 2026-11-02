// src/components/auth/ResetPassword.tsx
// The link mailed for a forgotten password: a new password, then signing
// in with it, as on any device.
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	AccountServerError,
	accountSyncService,
} from '../../services/AccountSyncService';

interface ResetPasswordProps {
	token: string;
	onDone: () => void;
	onCancel: () => void;
}

const errorMessage = (error: unknown): string => {
	const code = error instanceof AccountServerError ? error.code : '';
	if (code === 'expired_token' || code === 'invalid_token') {
		return t(
			'This link has expired or was already used. Ask for a new one from the sign-in page.',
		);
	}
	if (code === 'invalid_password') {
		return t('Password must be at least 6 characters long');
	}
	if (code === 'too_many_attempts') {
		return t('Too many attempts. Please try again in a few minutes.');
	}
	return t('The server could not be reached. Please try again later.');
};

const ResetPassword: React.FC<ResetPasswordProps> = ({
	token,
	onDone,
	onCancel,
}) => {
	const { login } = useAuth();
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!password) {
			setError(t('Please fill in all fields'));
			return;
		}
		if (password !== confirmPassword) {
			setError(t('Passwords do not match'));
			return;
		}
		setError(null);
		setBusy(true);
		try {
			const { username } = await accountSyncService.resetPassword(
				token,
				password,
			);
			// Brings the account here, or gives the account already in this
			// browser its new password.
			await login(username, password);
			onDone();
		} catch (caught) {
			setError(
				caught instanceof AccountServerError
					? errorMessage(caught)
					: caught instanceof Error
						? caught.message
						: errorMessage(caught),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='auth-form-container' data-role='reset-password'>
			<h2>{t('Choose a new password')}</h2>
			<p>
				{t(
					'Your other devices will have to sign in again, and assistants such as Claude lose their access.',
				)}
			</p>

			{error && (
				<div className='ui-message' data-tone='error'>
					{error}
				</div>
			)}

			<form onSubmit={submit} className='ui-stack'>
				<div className='ui-field' data-spacing='section'>
					<label htmlFor='reset-password'>{t('New Password')}</label>
					<input
						type='password'
						id='reset-password'
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						disabled={busy}
						autoComplete='new-password'
					/>
				</div>
				<div className='ui-field' data-spacing='section'>
					<label htmlFor='reset-confirm'>{t('Confirm New Password')}</label>
					<input
						type='password'
						id='reset-confirm'
						value={confirmPassword}
						onChange={(event) => setConfirmPassword(event.target.value)}
						disabled={busy}
						autoComplete='new-password'
					/>
				</div>
				<button
					type='submit'
					className='button primary'
					data-action='reset-password'
					data-state={busy ? 'loading' : undefined}
					disabled={busy}
				>
					{t('Choose this password and log in')}
				</button>
				<button
					type='button'
					className='button'
					data-variant='text'
					onClick={onCancel}
					disabled={busy}
				>
					{t('Cancel')}
				</button>
			</form>
		</div>
	);
};

export default ResetPassword;
