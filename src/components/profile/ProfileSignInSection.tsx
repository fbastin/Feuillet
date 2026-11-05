// src/components/profile/ProfileSignInSection.tsx
// Signing in with Google or ORCID, as on Overleaf: the account may be linked
// to an account of that site, which then signs in to it on any device; or
// not any more. Of that account, the server keeps only what recognizes it,
// never its address nor its name. Shown only when the server signs in with
// that site.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import i18next, { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	AccountServerError,
	type AccountSyncStatus,
	type LinkStatus,
	accountSyncService,
} from '../../services/AccountSyncService';
import {
	PROVIDER_NAMES,
	type SignInProvider,
} from '../../services/ExternalSignInService';
import ExternalSignInButton from '../auth/ExternalSignInButton';

const errorMessage = (error: unknown, id: SignInProvider): string => {
	const code = error instanceof AccountServerError ? error.code : '';
	const provider = PROVIDER_NAMES[id];
	if (code === 'wrong_password') return t('Invalid password');
	if (code === `${id}_taken`) {
		return t(
			'This {provider} account is already linked to another Feuillet account.',
			{ provider },
		);
	}
	if (code === 'invalid_ticket') {
		return t(
			'The confirmation from {provider} expired. Sign in with {provider} again.',
			{ provider },
		);
	}
	if (code === 'too_many_attempts') {
		return t('Too many attempts. Please try again in a few minutes.');
	}
	return t('The server could not be reached. Please try again later.');
};

const ProfileSignInSection: React.FC<{ provider: SignInProvider }> = ({
	provider: id,
}) => {
	const provider = PROVIDER_NAMES[id];
	const { user, isGuestUser } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [link, setLink] = useState<LinkStatus | null>(null);
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => accountSyncService.addListener(setStatus), []);
	const linked = status.state !== 'signed-out' && accountSyncService.isLinked();

	const load = useCallback(async () => {
		try {
			setLink(await accountSyncService.linkStatus(id));
		} catch {
			setLink(null);
		}
	}, [id]);

	useEffect(() => {
		if (linked) void load();
	}, [linked, load]);

	if (!user || isGuestUser(user) || !linked || !link?.enabled) return null;

	const needPassword = (): boolean => {
		setNotice(null);
		if (password) {
			setError(null);
			return true;
		}
		setError(
			t('Enter your password to change how you sign in with {provider}.', {
				provider,
			}),
		);
		return false;
	};

	const change = async (ticket: string | null) => {
		setBusy(true);
		setError(null);
		try {
			const updated = await accountSyncService.setLink(id, ticket, password);
			if (updated) setLink(updated);
			setPassword('');
			setNotice(
				ticket === null
					? t('{provider} no longer signs in to your account.', { provider })
					: t('{provider} now signs you in to your account, on any device.', {
							provider,
						}),
			);
		} catch (caught) {
			setError(errorMessage(caught, id));
		} finally {
			setBusy(false);
		}
	};

	const since = link.linkedAt
		? new Date(link.linkedAt).toLocaleDateString(i18next.language, {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			})
		: '';

	return (
		<div
			className='ui-stack recovery-section'
			data-gap='sm'
			data-role={`profile-${id}`}
		>
			<h3>{t('Sign in with {provider}', { provider })}</h3>
			<p>
				{t(
					'Link your {provider} account to sign in with it, as on Overleaf. Feuillet keeps only what recognizes that account, neither its address nor its name; your password still opens your account.',
					{ provider },
				)}
			</p>
			<p className='ui-meta' data-role={`${id}-status`}>
				{link.linked
					? t('Your account is linked to {provider} since {date}.', {
							provider,
							date: since,
						})
					: t('Your account is not linked to {provider}.', {
							provider,
						})}
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
					data-role={`${id}-notice`}
				>
					{notice}
				</div>
			)}

			<div className='ui-field'>
				<label htmlFor={`${id}-password`}>{t('Your password')}</label>
				<input
					type='password'
					id={`${id}-password`}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					autoComplete='current-password'
					disabled={busy}
				/>
			</div>
			<div className='ui-actions' data-align='end' data-wrap='true'>
				{link.linked && (
					<button
						type='button'
						className='button secondary'
						data-action={`unlink-${id}`}
						disabled={busy}
						onClick={() => {
							if (needPassword()) void change(null);
						}}
					>
						{t('Unlink {provider}', { provider })}
					</button>
				)}
				<ExternalSignInButton
					provider={id}
					variant='inline'
					label={
						link.linked
							? t('Link another {provider} account', { provider })
							: t('Link {provider}', { provider })
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

export default ProfileSignInSection;
