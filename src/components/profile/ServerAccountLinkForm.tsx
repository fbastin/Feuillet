// src/components/profile/ServerAccountLinkForm.tsx
// Linking this browser's account to the server, where it is needed rather
// than only in the profile: an account kept only in this browser cannot
// invite collaborators.
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { linkServerAccount } from './serverAccountLink';

interface ServerAccountLinkFormProps {
	reason: string;
	onLinked: () => void;
}

const ServerAccountLinkForm: React.FC<ServerAccountLinkFormProps> = ({
	reason,
	onLinked,
}) => {
	const { user, isGuestUser, verifyPassword } = useAuth();
	const [password, setPassword] = useState('');
	// Two-factor authentication's, once the server asks for it.
	const [code, setCode] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!user || isGuestUser(user)) {
		return (
			<p className='ui-meta' data-role='link-server-account'>
				{t('A guest session has no server account: create an account first.')}
			</p>
		);
	}

	const link = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!password) return;
		setBusy(true);
		setError(null);
		try {
			const result = await linkServerAccount(
				user,
				password,
				verifyPassword,
				code?.trim() || undefined,
			);
			if (result.linked) {
				setPassword('');
				setCode(null);
				onLinked();
			} else {
				if (result.needsCode) setCode('');
				setError(result.message);
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			className='ui-stack'
			data-gap='xs'
			data-role='link-server-account'
			onSubmit={link}
		>
			<p className='ui-meta'>
				{t(
					'Your account "{username}" is only in this browser, not on the server yet. {reason} Enter your password to link it.',
					{ username: user.username, reason },
				)}
			</p>
			<div className='project-share-invite'>
				<input
					id='link-server-password'
					className='ui-field-control'
					type='password'
					autoComplete='current-password'
					placeholder={t('Password')}
					aria-label={t('Password')}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					disabled={busy}
				/>
				{code !== null && (
					<input
						id='link-server-code'
						className='ui-field-control'
						autoComplete='one-time-code'
						placeholder={t('Code')}
						aria-label={t('Code of two-factor authentication')}
						value={code}
						onChange={(event) => setCode(event.target.value)}
						disabled={busy}
					/>
				)}
				<button
					type='submit'
					className='button primary'
					disabled={busy || !password || code === ''}
					aria-busy={busy}
				>
					{t('Link to the server')}
				</button>
			</div>
			{error && (
				<div className='ui-message' data-tone='warning'>
					{error}
				</div>
			)}
		</form>
	);
};

export default ServerAccountLinkForm;
