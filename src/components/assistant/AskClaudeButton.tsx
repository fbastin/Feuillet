// src/components/assistant/AskClaudeButton.tsx
// "Ask Claude" in the editor: a request about the passage or the project,
// sent to Claude in a new tab (claude.ai, under the person's own
// subscription) or copied for Claude Code. Claude then works on the project
// through the Feuillet connector, its changes coming back as suggestions.
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { useCollab } from '../../hooks/useCollab';
import { fileStoreService } from '../../services/FileStoreService';
import type { DocumentList } from '../../types/documents';
import {
	type AskClaudeContext,
	askClaudePrompt,
	claudeUrl,
	passageOf,
} from '../../utils/askClaude';
import { AssistantIcon } from '../common/Icons';
import Modal from '../common/Modal';
import { OPEN_PROFILE_EVENT } from '../profile/ProfileSettingsModal';

export interface AskClaudeLocation {
	path?: string;
	line?: number;
	selection?: string;
}

interface AskClaudeButtonProps {
	/** Where the cursor is when the button is pressed. */
	getLocation: () => AskClaudeLocation;
	className?: string;
}

const AskClaudeButton: React.FC<AskClaudeButtonProps> = ({
	getLocation,
	className = '',
}) => {
	const { data } = useCollab<DocumentList>();
	const [context, setContext] = useState<AskClaudeContext | null>(null);
	const [request, setRequest] = useState('');
	const [notice, setNotice] = useState<string | null>(null);

	const open = () => {
		setContext({
			projectName: data?.projectMetadata?.name ?? '',
			projectId: fileStoreService.getCurrentProjectId() ?? '',
			...getLocation(),
		});
		setRequest('');
		setNotice(null);
	};
	const close = () => setContext(null);

	const passage = passageOf(context?.selection);
	const prompt = context ? askClaudePrompt(context, request) : '';

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(prompt);
			return true;
		} catch {
			return false;
		}
	};

	const openInClaude = async () => {
		// Copied too, should Claude not fill in the message.
		const copied = await copy();
		window.open(claudeUrl(prompt), '_blank', 'noopener');
		setNotice(
			copied
				? t(
						'Claude opened in a new tab with your request. It is also copied: paste it there if the message box is empty.',
					)
				: t('Claude opened in a new tab with your request.'),
		);
	};

	const copyForClaudeCode = async () => {
		setNotice(
			(await copy())
				? t('Copied: paste it in Claude Code.')
				: t('Failed to copy'),
		);
	};

	const presets = [
		...(passage.text
			? [
					t('Improve the style of this passage.'),
					t('Correct the spelling and grammar of this passage.'),
					t('Explain this passage.'),
					t('Translate this passage into English.'),
				]
			: []),
		t('Compile the project and fix its errors.'),
		t('Answer the open comments.'),
	];

	return (
		<>
			<button
				type='button'
				className={`button ${className}`}
				data-action='ask-claude'
				onClick={open}
				title={t('Ask Claude')}
			>
				<AssistantIcon />
			</button>
			<Modal
				isOpen={context !== null}
				onClose={close}
				title={t('Ask Claude')}
				icon={AssistantIcon}
				size='medium'
			>
				{context && (
					<div className='ask-claude ui-stack' data-gap='sm'>
						<p className='ui-meta' data-role='ask-claude-location'>
							{context.path
								? t('Project "{project}", {path}, line {line}', {
										project: context.projectName || t('Untitled Project'),
										path: context.path,
										line: context.line ?? 1,
									})
								: t('Project "{project}"', {
										project: context.projectName || t('Untitled Project'),
									})}
						</p>
						{passage.text && (
							<pre
								className='ask-claude-passage'
								data-role='ask-claude-passage'
							>
								{passage.text}
							</pre>
						)}
						<label className='ui-field-label' htmlFor='ask-claude-request'>
							{t('What should Claude do?')}
						</label>
						<textarea
							id='ask-claude-request'
							className='ui-field-control'
							rows={3}
							value={request}
							placeholder={
								passage.text
									? t('For example: make this paragraph shorter.')
									: t('For example: add a related work section.')
							}
							onChange={(event) => setRequest(event.target.value)}
						/>
						<div className='ask-claude-presets' data-role='ask-claude-presets'>
							{presets.map((preset) => (
								<button
									key={preset}
									type='button'
									className='button secondary'
									onClick={() => setRequest(preset)}
								>
									{preset}
								</button>
							))}
						</div>
						<div className='ui-actions' data-gap='xs'>
							<button
								type='button'
								className='button primary'
								data-action='open-in-claude'
								disabled={!request.trim()}
								onClick={() => void openInClaude()}
							>
								{t('Open in Claude')}
							</button>
							<button
								type='button'
								className='button secondary'
								data-action='copy-for-claude-code'
								disabled={!request.trim()}
								onClick={() => void copyForClaudeCode()}
							>
								{t('Copy for Claude Code')}
							</button>
						</div>
						{notice && (
							<div
								className='ui-message'
								data-tone='info'
								data-role='ask-claude-notice'
							>
								{notice}
							</div>
						)}
						<p className='ui-meta'>
							{t(
								'Claude works on the project through the Feuillet connector, and its changes come back here as suggestions.',
							)}{' '}
							<button
								type='button'
								className='ask-claude-setup'
								data-action='set-up-connector'
								onClick={() => {
									close();
									document.dispatchEvent(
										new CustomEvent(OPEN_PROFILE_EVENT, {
											detail: { tab: 'assistants' },
										}),
									);
								}}
							>
								{t('Set up the connector')}
							</button>
						</p>
					</div>
				)}
			</Modal>
		</>
	);
};

export default AskClaudeButton;
