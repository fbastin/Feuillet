// src/components/history/GitAccountTokenForm.tsx
import type React from 'react';
import { useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import { ExternalLinkIcon, KeyIcon } from '@/components/common/Icons';
import type { GitRemoteProvider } from '@/types/gitRemote';

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
				{t(
					'{app} talks to {provider} directly from your browser with a personal access token. The token is encrypted with your account password and stored only in this browser.',
					{ app: APP_NAME, provider: provider.displayName },
				)}
			</p>
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
					className='button primary'
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
