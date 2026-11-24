// src/components/assistant/AssistantRequestsPanel.tsx
// In « Ask Claude »: the project's requests to assistants, written \prompt{…}
// with feuillet.sty (server/collab/prompts.js). Claude answers them through
// the connector, asked as any request (claude.ai, Claude Code), or from here
// through Anthropic's API with the account's own key
// (server/collab/promptRunner.js); its answers come back as suggestions.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import { useFileTree } from '../../hooks/useFileTree';
import { useSecrets } from '../../hooks/useSecrets';
import {
	type AssistantRequests,
	type AssistantRun,
	AccountServerError,
	accountSyncService,
} from '../../services/AccountSyncService';
import {
	ANTHROPIC_KEY_SECRET,
	ASSISTANT_MODELS,
	ASSISTANT_SECRETS_ID,
	metadataOf,
	runErrorText,
} from '../../utils/assistantApi';
import {
	FEUILLET_STY_NAME,
	hasFeuilletSty,
	loadFeuilletSty,
} from '../../utils/feuilletPackage';

const SHOWN = 8;
const POLL_MS = 2000;

// The run of each project, which outlives the dialog.
const runs = new Map<string, string>();

const shorten = (text: string, max = 160) => {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

interface AssistantRequestsPanelProps {
	projectId: string;
	/** Puts the request for them in the dialog, for Claude or Claude Code. */
	onAskForRequests: () => void;
	/** Opens the profile's Assistants tab. */
	onSetUp: () => void;
}

const AssistantRequestsPanel: React.FC<AssistantRequestsPanelProps> = ({
	projectId,
	onAskForRequests,
	onSetUp,
}) => {
	const { getSecret, hasSecret, getSecretMetadata } = useSecrets();
	const { fileTree, uploadFiles } = useFileTree();
	// undefined while loading; null when the server does not list them.
	const [found, setFound] = useState<AssistantRequests | null | undefined>(
		undefined,
	);
	const [runId, setRunId] = useState<string | null>(
		runs.get(projectId) ?? null,
	);
	const [run, setRun] = useState<AssistantRun | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [added, setAdded] = useState(false);

	const hasKey = hasSecret(ASSISTANT_SECRETS_ID, ANTHROPIC_KEY_SECRET, {
		scope: 'global',
	});
	const settings = metadataOf(
		getSecretMetadata(ASSISTANT_SECRETS_ID, ANTHROPIC_KEY_SECRET, {
			scope: 'global',
		}),
	);
	const modelLabel =
		ASSISTANT_MODELS.find((model) => model.id === settings.model)?.label ??
		settings.model;

	const load = useCallback(async () => {
		try {
			setFound(await accountSyncService.assistantRequests(projectId));
		} catch {
			setFound(null);
		}
	}, [projectId]);

	useEffect(() => {
		void load();
	}, [load]);

	// Where the run stands, until it ends.
	useEffect(() => {
		if (!runId) return;
		let current = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const check = async () => {
			try {
				const state = await accountSyncService.assistantRun(runId);
				if (!current) return;
				setRun(state);
				if (state.state === 'running') {
					timer = setTimeout(() => void check(), POLL_MS);
					return;
				}
				runs.delete(projectId);
				setRunId(null);
				void load();
			} catch (caught) {
				if (!current) return;
				// Forgotten by the server (restarted, or an hour after it ended).
				runs.delete(projectId);
				setRunId(null);
				if (!(caught instanceof AccountServerError && caught.status === 404)) {
					setError(runErrorText({ code: 'unreachable' }));
				}
			}
		};
		void check();
		return () => {
			current = false;
			if (timer) clearTimeout(timer);
		};
	}, [runId, projectId, load]);

	if (!found) {
		return found === undefined ? (
			<p className='ui-meta' data-role='assistant-requests-loading'>
				{t('Looking for requests in the project…')}
			</p>
		) : null;
	}

	const start = async () => {
		setBusy(true);
		setError(null);
		setRun(null);
		try {
			const key = (
				await getSecret(ASSISTANT_SECRETS_ID, ANTHROPIC_KEY_SECRET, {
					scope: 'global',
				})
			)?.value?.trim();
			if (!key) {
				setError(t('Your API key is unavailable. Enter it again.'));
				return;
			}
			const id = await accountSyncService.startAssistantRun({
				project: projectId,
				key,
				model: settings.model,
				name: settings.name,
			});
			if (!id) {
				setError(
					t('No request is for {name}.', {
						name: `${settings.name} (API)`,
					}),
				);
				return;
			}
			runs.set(projectId, id);
			setRunId(id);
		} catch (caught) {
			setError(
				runErrorText(
					caught instanceof AccountServerError
						? { code: caught.code }
						: undefined,
				),
			);
		} finally {
			setBusy(false);
		}
	};

	const stop = async () => {
		if (!runId) return;
		try {
			setRun(await accountSyncService.assistantRun(runId, true));
		} catch {}
	};

	const addPackage = async () => {
		const content = await loadFeuilletSty();
		if (!content) return;
		await uploadFiles(
			[new File([content], FEUILLET_STY_NAME, { type: 'text/x-tex' })],
			'/',
		);
		setAdded(true);
	};

	const running = run?.state === 'running' || (runId !== null && !run);
	const { requests } = found;

	const runMessage = (state: AssistantRun) => {
		const counts = { count: state.answered, total: state.requests };
		switch (state.state) {
			case 'running':
				return t(
					'Claude is answering the requests: {count} of {total} answered so far.',
					counts,
				);
			case 'done':
				return t(
					'Claude answered {count} of {total} requests. Its answers are suggestions: accept or reject them in the review panel.',
					counts,
				);
			case 'stopped':
				return `${t('Stopped: {count} of {total} requests answered.', counts)}${
					state.error ? ` ${runErrorText(state.error)}` : ''
				}`;
			default:
				return `${runErrorText(state.error)}${
					state.answered
						? ` ${t('{count} of {total} requests were answered before.', counts)}`
						: ''
				}`;
		}
	};

	return (
		<section
			className='ask-claude-requests ui-stack'
			data-gap='xs'
			data-role='assistant-requests'
		>
			<h4>{t('Requests in the project')}</h4>
			{requests.length === 0 ? (
				<p className='ui-meta'>
					{t(
						"No request yet. Write \\prompt{…} in a LaTeX file where you want an assistant's work, after \\usepackage{feuillet} in the preamble.",
					)}
				</p>
			) : (
				<>
					<ul className='ask-claude-request-list'>
						{requests.slice(0, SHOWN).map((request) => (
							<li key={request.id} data-request={request.id}>
								<span className='ui-meta'>
									{request.path.replace(/^\//, '')}:{request.line}
									{request.agent ? ` · ${request.agent}` : ''}
								</span>{' '}
								<span>{shorten(request.text)}</span>
							</li>
						))}
					</ul>
					{requests.length > SHOWN && (
						<p className='ui-meta'>
							{t('And {more} more.', { more: requests.length - SHOWN })}
						</p>
					)}
					<div className='ui-actions' data-gap='xs'>
						<button
							type='button'
							className='button secondary'
							data-action='ask-for-requests'
							onClick={onAskForRequests}
						>
							{t('Ask for them in Claude')}
						</button>
						{hasKey && (
							<button
								type='button'
								className='button primary'
								data-action='answer-with-api'
								disabled={busy || running || found.project.access === 'view'}
								aria-busy={busy}
								onClick={() => void start()}
							>
								{t('Answer with {model}', { model: modelLabel })}
							</button>
						)}
						{running && runId && (
							<button
								type='button'
								className='button secondary'
								data-action='stop-api-run'
								onClick={() => void stop()}
							>
								{t('Stop')}
							</button>
						)}
					</div>
					{!hasKey && (
						<p className='ui-meta'>
							{t(
								'With your own API key, Claude can also answer them from here.',
							)}{' '}
							<button
								type='button'
								className='ask-claude-setup'
								data-action='set-up-api-key'
								onClick={onSetUp}
							>
								{t('Add an API key')}
							</button>
						</p>
					)}
				</>
			)}
			{run && (
				<div
					className='ui-message'
					data-tone={
						run.state === 'failed'
							? 'warning'
							: run.state === 'done'
								? 'success'
								: 'info'
					}
					data-role='assistant-run'
					data-state={run.state}
				>
					{runMessage(run)}
					{run.summary && run.state !== 'running' && (
						<span className='ui-meta' data-role='assistant-run-summary'>
							{' '}
							{shorten(run.summary, 400)}
						</span>
					)}
				</div>
			)}
			{error && (
				<div className='ui-message' data-tone='warning'>
					{error}
				</div>
			)}
			{requests.length > 0 && !found.loads && (
				<div className='ui-message' data-tone='warning'>
					{t(
						'This project does not load feuillet.sty: add \\usepackage{feuillet} to its preamble, or it will not compile.',
					)}
				</div>
			)}
			{found.loads && !added && !hasFeuilletSty(fileTree) && (
				<p className='ui-meta'>
					{t(
						'{app} has feuillet.sty; to compile the project elsewhere too (Git, archives), add a copy of it to the project.',
						{ app: APP_NAME },
					)}{' '}
					<button
						type='button'
						className='ask-claude-setup'
						data-action='add-feuillet-sty'
						onClick={() => void addPackage()}
					>
						{t('Add feuillet.sty')}
					</button>
				</p>
			)}
		</section>
	);
};

export default AssistantRequestsPanel;
