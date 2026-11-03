// src/components/profile/ProfileGitSection.tsx
// Git tokens, as Overleaf's Git authentication tokens: Git gives one, with
// the account's name, to clone, pull and push projects
// (server/collab/git.js), instead of the password. A token is shown once,
// when it is made; the profile lists them and takes them back.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	AccountServerError,
	type AccountSyncStatus,
	type GitToken,
	accountSyncService,
} from '../../services/AccountSyncService';
import CopyField from '../common/CopyField';
import ServerAccountLinkForm from './ServerAccountLinkForm';

const dateOf = (time: number) =>
	new Date(time).toLocaleDateString(undefined, { dateStyle: 'long' });

const ProfileGitSection: React.FC = () => {
	const { user, isGuestUser } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [tokens, setTokens] = useState<GitToken[] | null>(null);
	const [label, setLabel] = useState('');
	const [password, setPassword] = useState('');
	const [made, setMade] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => accountSyncService.addListener(setStatus), []);
	const linked = status.state !== 'signed-out' && accountSyncService.isLinked();

	const load = useCallback(async () => {
		try {
			setTokens(await accountSyncService.gitTokens());
		} catch (caught) {
			setTokens(null);
			setError(
				caught instanceof AccountServerError && caught.status === 404
					? t('This server does not offer Git yet.')
					: t('The server could not be reached. Please try again later.'),
			);
		}
	}, []);

	useEffect(() => {
		if (linked) void load();
	}, [linked, load]);

	if (!user || isGuestUser(user)) return null;

	const create = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!password) return;
		setBusy('create');
		setError(null);
		setMade(null);
		try {
			const result = await accountSyncService.createGitToken(
				password,
				label.trim(),
			);
			setMade(result.token);
			setTokens(result.tokens);
			setPassword('');
			setLabel('');
		} catch (caught) {
			const code = caught instanceof AccountServerError ? caught.code : '';
			setError(
				code === 'wrong_password'
					? t('Invalid password')
					: code === 'too_many_tokens'
						? t('An account has 10 Git tokens at most: delete one first.')
						: t('The server could not be reached. Please try again later.'),
			);
		} finally {
			setBusy(null);
		}
	};

	const revoke = async (token: GitToken) => {
		setBusy(token.id);
		setError(null);
		try {
			setTokens(await accountSyncService.revokeGitToken(token.id));
		} catch {
			setError(t('The server could not be reached. Please try again later.'));
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className='ui-stack git-section' data-gap='sm'>
			<h3>{t('Git')}</h3>
			<p>
				{t(
					"Clone your projects with Git, work on them on your computer, then push your changes: they appear in Feuillet at once, for your collaborators too. Each project's Git address is under Git, at the top of the editor.",
				)}
			</p>

			{!linked ? (
				<ServerAccountLinkForm
					reason={t('Git works with the projects kept on the server.')}
					onLinked={() => setStatus(accountSyncService.getStatus())}
				/>
			) : (
				<>
					<h4>{t('Git tokens')}</h4>
					<p className='ui-meta'>
						{t(
							'When Git asks for a password, give one of these tokens, with your account name {username}; your password does not work there. Changing your password deletes them.',
							{ username: user.username },
						)}
					</p>

					{made && (
						<div
							className='ui-message ui-stack'
							data-tone='warning'
							data-gap='xs'
							data-role='git-token-made'
						>
							<strong>
								{t(
									'Copy this token now, into your password manager or Git: it will not be shown again.',
								)}
							</strong>
							<CopyField id='git-token' value={made} mono />
						</div>
					)}

					{error && (
						<div className='ui-message' data-tone='error'>
							{error}
						</div>
					)}

					{tokens && tokens.length === 0 && (
						<p className='ui-meta' data-role='git-no-tokens'>
							{t('No Git token yet.')}
						</p>
					)}
					{tokens && tokens.length > 0 && (
						<ul className='account-devices' data-role='git-tokens'>
							{tokens.map((token) => (
								<li key={token.id} data-token={token.id}>
									<div>
										<strong>
											{token.label || t('Git token')}{' '}
											<code className='ui-meta'>{token.hint}…</code>
										</strong>
										<span className='ui-meta'>
											{token.lastUsedAt
												? t('Made on {date}, last used on {used}', {
														date: dateOf(token.createdAt),
														used: dateOf(token.lastUsedAt),
													})
												: t('Made on {date}, never used', {
														date: dateOf(token.createdAt),
													})}
										</span>
									</div>
									<button
										type='button'
										className='button secondary'
										data-action='revoke-git-token'
										disabled={busy !== null}
										aria-busy={busy === token.id}
										onClick={() => void revoke(token)}
									>
										{t('Delete')}
									</button>
								</li>
							))}
						</ul>
					)}

					<form className='ui-stack' data-gap='xs' onSubmit={create}>
						<div className='ui-field'>
							<label htmlFor='git-token-label'>
								{t('What it is for (optional)')}
							</label>
							<input
								type='text'
								id='git-token-label'
								value={label}
								maxLength={60}
								placeholder={t('My laptop')}
								onChange={(event) => setLabel(event.target.value)}
								disabled={busy !== null}
							/>
						</div>
						<div className='ui-field'>
							<label htmlFor='git-token-password'>
								{t('Your password, to make a token')}
							</label>
							<input
								type='password'
								id='git-token-password'
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								autoComplete='current-password'
								disabled={busy !== null}
							/>
						</div>
						<div className='ui-actions' data-align='end'>
							<button
								type='submit'
								className='button primary'
								data-action='create-git-token'
								disabled={busy !== null || !password}
								aria-busy={busy === 'create'}
							>
								{t('Make a Git token')}
							</button>
						</div>
					</form>
				</>
			)}
		</div>
	);
};

export default ProfileGitSection;
