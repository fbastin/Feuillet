// src/components/auth/RecoverAccount.tsx
// A forgotten password: a link mailed to the account's recovery address, as
// on Overleaf, when the server sends mail; or one of the account's recovery
// codes, which sets a new password on the server, then signs in with it.
import type React from 'react';
import { useEffect, useState } from 'react';

import i18next, { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	AccountServerError,
	accountSyncService,
} from '../../services/AccountSyncService';

interface RecoverAccountProps {
	initialUsername: string;
	onRecovered: () => void;
	onCancel: () => void;
}

const errorMessage = (error: unknown): string => {
	const code = error instanceof AccountServerError ? error.code : '';
	if (code === 'invalid_recovery') {
		return t(
			'This code is not one of the recovery codes of this account, or it was already used.',
		);
	}
	if (code === 'invalid_password') {
		return t('Password must be at least 6 characters long');
	}
	if (code === 'too_many_attempts') {
		return t('Too many attempts. Please try again in a few minutes.');
	}
	if (code === 'not_found') {
		return t('The server does not offer recovery codes yet.');
	}
	return t('The server could not be reached. Please try again later.');
};

const RecoverAccount: React.FC<RecoverAccountProps> = ({
	initialUsername,
	onRecovered,
	onCancel,
}) => {
	const { login } = useAuth();
	const [username, setUsername] = useState(initialUsername);
	const [code, setCode] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// By email when the server sends mail; null while asking it.
	const [mode, setMode] = useState<'email' | 'code' | null>(null);
	const [emailOffered, setEmailOffered] = useState(false);
	const [loginName, setLogin] = useState(initialUsername);
	const [sent, setSent] = useState(false);

	useEffect(() => {
		let current = true;
		void accountSyncService.recoveryOptions().then(({ email }) => {
			if (!current) return;
			setEmailOffered(email);
			setMode(email ? 'email' : 'code');
		});
		return () => {
			current = false;
		};
	}, []);

	const sendLink = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!loginName.trim()) {
			setError(t('Please fill in all fields'));
			return;
		}
		setError(null);
		setBusy(true);
		try {
			await accountSyncService.forgotPassword(
				loginName.trim(),
				i18next.language,
			);
			setSent(true);
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	const switchTo = (next: 'email' | 'code') => {
		setError(null);
		setSent(false);
		setMode(next);
	};

	if (mode !== 'code') {
		return (
			<div className='auth-form-container' data-role='recover-account'>
				<h2>{t('Forgot your password?')}</h2>
				{mode === null ? (
					<p className='ui-meta'>{t('Loading...')}</p>
				) : sent ? (
					<div
						className='ui-message'
						data-tone='success'
						data-role='reset-link-sent'
					>
						{t(
							'If this name or address belongs to an account whose email address is confirmed, a link was just sent there: it works for one hour. Look in your spam folder too.',
						)}
					</div>
				) : (
					<>
						<p>
							{t(
								'Enter your username or your account email: Feuillet sends a link to that address to choose a new password.',
							)}
						</p>
						{error && (
							<div className='ui-message' data-tone='error'>
								{error}
							</div>
						)}
						<form onSubmit={sendLink} className='ui-stack'>
							<div className='ui-field' data-spacing='section'>
								<label htmlFor='forgot-login'>
									{t('Username or email address')}
								</label>
								<input
									type='text'
									id='forgot-login'
									value={loginName}
									onChange={(event) => setLogin(event.target.value)}
									disabled={busy}
									autoComplete='username'
								/>
							</div>
							<button
								type='submit'
								className='button primary'
								data-action='send-reset-link'
								data-state={busy ? 'loading' : undefined}
								disabled={busy}
							>
								{t('Send me a link')}
							</button>
						</form>
					</>
				)}
				<div className='ui-stack' data-gap='xs'>
					<button
						type='button'
						className='button'
						data-variant='text'
						data-action='use-recovery-code'
						onClick={() => switchTo('code')}
						disabled={busy}
					>
						{t('I have a recovery code')}
					</button>
					<button
						type='button'
						className='button'
						data-variant='text'
						onClick={onCancel}
						disabled={busy}
					>
						{t('Back')}
					</button>
				</div>
			</div>
		);
	}

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!username.trim() || !code.trim() || !password) {
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
			const recovered = await accountSyncService.recover(
				username.trim(),
				code,
				password,
			);
			// Signing in with the new password brings the account here, or
			// gives the account already in this browser its new password.
			await login(recovered.username, password);
			onRecovered();
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
		<div className='auth-form-container' data-role='recover-account'>
			<h2>{t('Forgot your password?')}</h2>
			<p>
				{t(
					'Enter one of the recovery codes you made in your profile, and choose a new password. Each code works once; your other devices will have to sign in again.',
				)}
			</p>

			{error && (
				<div className='ui-message' data-tone='error'>
					{error}
				</div>
			)}

			<form onSubmit={submit} className='ui-stack'>
				<div className='ui-field' data-spacing='section'>
					<label htmlFor='recover-username'>{t('Username')}</label>
					<input
						type='text'
						id='recover-username'
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						disabled={busy}
						autoComplete='username'
					/>
				</div>
				<div className='ui-field' data-spacing='section'>
					<label htmlFor='recover-code'>{t('Recovery code')}</label>
					<input
						type='text'
						id='recover-code'
						value={code}
						onChange={(event) => setCode(event.target.value)}
						disabled={busy}
						autoComplete='one-time-code'
						spellCheck={false}
						placeholder='xxxx-xxxx-xxxx-xxxx'
					/>
				</div>
				<div className='ui-field' data-spacing='section'>
					<label htmlFor='recover-password'>{t('New Password')}</label>
					<input
						type='password'
						id='recover-password'
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						disabled={busy}
						autoComplete='new-password'
					/>
				</div>
				<div className='ui-field' data-spacing='section'>
					<label htmlFor='recover-confirm'>{t('Confirm New Password')}</label>
					<input
						type='password'
						id='recover-confirm'
						value={confirmPassword}
						onChange={(event) => setConfirmPassword(event.target.value)}
						disabled={busy}
						autoComplete='new-password'
					/>
				</div>
				<button
					type='submit'
					className='button primary'
					data-action='recover-account'
					data-state={busy ? 'loading' : undefined}
					disabled={busy}
				>
					{t('Choose this password and log in')}
				</button>
				{emailOffered && (
					<button
						type='button'
						className='button'
						data-variant='text'
						data-action='use-email'
						onClick={() => switchTo('email')}
						disabled={busy}
					>
						{t('Get a link by email instead')}
					</button>
				)}
				<button
					type='button'
					className='button'
					data-variant='text'
					onClick={onCancel}
					disabled={busy}
				>
					{t('Back')}
				</button>
			</form>
		</div>
	);
};

export default RecoverAccount;
