// src/components/profile/ProfileAssistantApiSection.tsx
// The account's Anthropic API key, with which Feuillet itself has Claude
// answer a project's requests (\prompt) from « Ask Claude »
// (server/collab/promptRunner.js). The key is encrypted with the account's
// password and kept in this browser only; the model and the assistant's
// name are kept beside it.
import type React from 'react';
import { useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import { useSecrets } from '../../hooks/useSecrets';
import {
	ANTHROPIC_KEY_SECRET,
	ASSISTANT_MODELS,
	ASSISTANT_SECRETS_ID,
	keyHint,
	metadataOf,
} from '../../utils/assistantApi';

const ProfileAssistantApiSection: React.FC = () => {
	const { setSecret, getSecret, removeSecret, hasSecret, getSecretMetadata } =
		useSecrets();
	const saved = hasSecret(ASSISTANT_SECRETS_ID, ANTHROPIC_KEY_SECRET, {
		scope: 'global',
	});
	const metadata = metadataOf(
		getSecretMetadata(ASSISTANT_SECRETS_ID, ANTHROPIC_KEY_SECRET, {
			scope: 'global',
		}),
	);
	const [key, setKey] = useState('');
	const [model, setModel] = useState(metadata.model);
	const [name, setName] = useState(metadata.name);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{
		tone: 'info' | 'warning';
		text: string;
	} | null>(null);

	const changed =
		key.trim() !== '' ||
		(saved && (model !== metadata.model || name.trim() !== metadata.name));

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setMessage(null);
		try {
			// A new key, or the one kept, with another model or name.
			const value =
				key.trim() ||
				(
					await getSecret(ASSISTANT_SECRETS_ID, ANTHROPIC_KEY_SECRET, {
						scope: 'global',
					})
				)?.value?.trim() ||
				'';
			if (!value) {
				setMessage({ tone: 'warning', text: t('Enter your API key.') });
				return;
			}
			if (/\s/.test(value) || value.length < 20) {
				setMessage({
					tone: 'warning',
					text: t('This does not look like an API key.'),
				});
				return;
			}
			await setSecret(ASSISTANT_SECRETS_ID, ANTHROPIC_KEY_SECRET, value, {
				scope: 'global',
				metadata: {
					model,
					name: name.trim() || metadata.name,
					hint: keyHint(value),
				},
				passwordMessage: t(
					'Enter your {app} password to encrypt and save your API key in this browser:',
					{ app: APP_NAME },
				),
			});
			setKey('');
			setMessage({ tone: 'info', text: t('Saved in this browser.') });
		} catch {
			setMessage({ tone: 'warning', text: t('Your API key was not saved.') });
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		setBusy(true);
		try {
			await removeSecret(ASSISTANT_SECRETS_ID, ANTHROPIC_KEY_SECRET, {
				scope: 'global',
			});
			setMessage(null);
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			className='ui-stack assistant-api'
			data-gap='xs'
			data-role='assistant-api-key'
			onSubmit={save}
		>
			<h4>{t('Answer requests with your API key')}</h4>
			<p className='ui-meta'>
				{t(
					"With a Claude API key (console.anthropic.com), {app} itself has Claude answer a project's requests, from Ask Claude in the editor. The calls are billed to your API account, not to a Claude subscription.",
					{ app: APP_NAME },
				)}
			</p>
			<p className='ui-meta'>
				{t(
					'The key is encrypted with your account password and kept only in this browser. The server receives it each time Claude answers, uses it for those calls alone, and keeps it nowhere.',
				)}
			</p>
			{saved && (
				<p data-role='assistant-api-saved'>
					{t('Key saved in this browser: {hint}', {
						hint: metadata.hint || '…',
					})}
				</p>
			)}
			<label className='ui-field-label' htmlFor='assistant-api-key'>
				{saved ? t('Replace the API key') : t('API key')}
			</label>
			<input
				id='assistant-api-key'
				className='ui-field-control'
				type='password'
				autoComplete='off'
				spellCheck={false}
				placeholder='sk-ant-…'
				value={key}
				onChange={(event) => setKey(event.target.value)}
				disabled={busy}
			/>
			<label className='ui-field-label' htmlFor='assistant-api-model'>
				{t('Model')}
			</label>
			<select
				id='assistant-api-model'
				value={model}
				onChange={(event) => setModel(event.target.value)}
				disabled={busy}
			>
				{ASSISTANT_MODELS.map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
			<label className='ui-field-label' htmlFor='assistant-api-name'>
				{t('Name of the assistant')}
			</label>
			<input
				id='assistant-api-name'
				className='ui-field-control'
				value={name}
				maxLength={40}
				onChange={(event) => setName(event.target.value)}
				disabled={busy}
			/>
			<p className='ui-meta'>
				{t(
					'It answers the requests for any assistant, and those whose name its own holds, followed by (API): with "Claude", \\prompt[claude]{…} and \\prompt[api]{…}.',
				)}
			</p>
			<div className='ui-actions' data-gap='xs'>
				<button
					type='submit'
					className='button primary'
					data-action='save-assistant-api-key'
					disabled={busy || !changed}
					aria-busy={busy}
				>
					{t('Save')}
				</button>
				{saved && (
					<button
						type='button'
						className='button secondary'
						data-action='remove-assistant-api-key'
						disabled={busy}
						onClick={() => void remove()}
					>
						{t('Remove the key')}
					</button>
				)}
			</div>
			{message && (
				<div className='ui-message' data-tone={message.tone}>
					{message.text}
				</div>
			)}
		</form>
	);
};

export default ProfileAssistantApiSection;
