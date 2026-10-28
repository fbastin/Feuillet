// src/components/history/GitAccountTokenForm.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import { ExternalLinkIcon, KeyIcon } from '@/components/common/Icons';
import { useAuth } from '@/hooks/useAuth';
import {
	type GitHubSignIn,
	gitHubOAuthService,
} from '@/services/GitHubOAuthService';
import type { GitRemoteProvider } from '@/types/gitRemote';
import { getAccountServerUrl } from '@/utils/accountSyncUtils';

interface GitAccountTokenFormProps {
	provider: GitRemoteProvider;
	isBusy: boolean;
	/** Resolves to true when the token was accepted. */
	onSubmit: (token: string) => Promise<boolean>;
	onCancel?: () => void;
}

const GitAccountTokenForm: React.FC<GitAccountTokenFormProps> = ({
	provider,
	isBusy,
	onSubmit,
	onCancel,
}) => {
	const [token, setToken] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);
	// "Sign in with GitHub", when the collaboration server offers it.
	const { user } = useAuth();
	const server = getAccountServerUrl(user?.id);
	const [canSignIn, setCanSignIn] = useState(false);
	const [signIn, setSignIn] = useState<GitHubSignIn | null>(null);
	const [signInError, setSignInError] = useState<string | null>(null);

	useEffect(() => {
		if (provider.id !== 'github' || !server) return;
		let current = true;
		void gitHubOAuthService.isAvailable(server).then((available) => {
			if (current) setCanSignIn(available);
		});
		return () => {
			current = false;
		};
	}, [provider.id, server]);

	const startSignIn = async () => {
		setSignInError(null);
		const attempt = gitHubOAuthService.signIn(server);
		setSignIn(attempt);
		try {
			const value = await attempt.token;
			setSignIn(null);
			setIsSubmitting(true);
			await onSubmit(value);
		} catch (error) {
			setSignInError(error instanceof Error ? error.message : String(error));
		} finally {
			setSignIn(null);
			setIsSubmitting(false);
		}
	};

	const submit = async () => {
		if (!token.trim() || isBusy || isSubmitting) return;
		setIsSubmitting(true);
		try {
			if (await onSubmit(token)) setToken('');
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<section
			className='ui-card ui-stack'
			data-gap='sm'
			data-padding='md'
			data-surface='secondary'
		>
			<h3>
				{t('Connect your {provider} account', {
					provider: provider.displayName,
				})}
			</h3>
			<p className='ui-note'>
				{canSignIn
					? t(
							'{app} talks to {provider} directly from your browser. Its token is encrypted with your account password and stored only in this browser.',
							{ app: APP_NAME, provider: provider.displayName },
						)
					: t(
							'{app} talks to {provider} directly from your browser with a personal access token. The token is encrypted with your account password and stored only in this browser.',
							{ app: APP_NAME, provider: provider.displayName },
						)}
			</p>
			{canSignIn ? (
				<div className='ui-stack' data-gap='xs'>
					{signIn ? (
						<div className='ui-actions'>
							<span className='ui-meta'>
								{t('Finish signing in in the {provider} window.', {
									provider: provider.displayName,
								})}
							</span>
							<button
								type='button'
								className='button secondary'
								onClick={signIn.cancel}
							>
								{t('Cancel')}
							</button>
						</div>
					) : (
						<div className='ui-actions'>
							<button
								type='button'
								className='button primary github-sign-in'
								disabled={isBusy || isSubmitting}
								onClick={() => void startSignIn()}
							>
								{isSubmitting
									? t('Connecting...')
									: t('Sign in with {provider}', {
											provider: provider.displayName,
										})}
							</button>
						</div>
					)}
					{signInError ? (
						<div className='ui-message' data-tone='warning'>
							{signInError}
						</div>
					) : null}
					<p className='ui-note'>{t('Or paste a personal access token:')}</p>
				</div>
			) : null}
			{provider.getTokenCreationUrl ? (
				<p className='ui-note'>
					<a
						href={provider.getTokenCreationUrl(APP_NAME)}
						target='_blank'
						rel='noreferrer'
					>
						{t('Create a token on {provider}', {
							provider: provider.displayName,
						})}{' '}
						<ExternalLinkIcon />
					</a>{' '}
					{t('(a classic token with the "repo" scope).')}
				</p>
			) : null}
			<label className='ui-field-label' htmlFor='git-account-token'>
				{t('Personal access token')}
			</label>
			<input
				id='git-account-token'
				type='password'
				autoComplete='off'
				value={token}
				disabled={isBusy || isSubmitting}
				placeholder='ghp_...'
				onChange={(event) => setToken(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Enter') void submit();
				}}
			/>
			<div className='ui-actions'>
				<button
					type='button'
					className={`button ${canSignIn ? 'secondary' : 'primary'}`}
					disabled={isBusy || isSubmitting || !token.trim()}
					onClick={() => void submit()}
				>
					<KeyIcon />
					{isSubmitting ? t('Connecting...') : t('Connect account')}
				</button>
				{onCancel ? (
					<button
						type='button'
						className='button secondary'
						disabled={isBusy || isSubmitting}
						onClick={onCancel}
					>
						{t('Cancel')}
					</button>
				) : null}
			</div>
		</section>
	);
};

export default GitAccountTokenForm;
