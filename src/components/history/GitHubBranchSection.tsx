// src/components/history/GitHubBranchSection.tsx
// Work on a branch, then propose it, as on GitHub: the project follows one
// branch of the repository; a new branch starts from it, the next pushes go
// there, and a pull request proposes it for merging into the default
// branch. Back on that branch once merged, or on any other, the project's
// files become the branch's, for every collaborator; what the branch left
// had that GitHub had not is pushed there first, so nothing is lost.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import type { GitActionSecrets } from '@/hooks/useGitRemoteAccount';
import { ExternalLinkIcon, GitBranchIcon } from '@/components/common/Icons';
import { gitProjectSyncService } from '@/services/GitProjectSyncService';
import type { GitRemoteSyncStatus } from '@/services/GitSyncService';
import type { User } from '@/types/auth';
import type {
	GitRemoteConfig,
	GitRemoteProvider,
	GitRemotePullRequest,
} from '@/types/gitRemote';
import { branchNameProblem, suggestBranchName } from '@/utils/gitBranch';

interface GitHubBranchSectionProps {
	provider: GitRemoteProvider;
	config: GitRemoteConfig;
	remoteName: string;
	projectId: string;
	user: User | null;
	syncStatus: GitRemoteSyncStatus | null;
	pendingChangeCount: number;
	isBusy: boolean;
	busyAction: string | null;
	commitMessage: () => string;
	run: (
		label: string,
		action: (secrets: GitActionSecrets) => Promise<void>,
	) => Promise<boolean>;
	readToken: (secrets: GitActionSecrets) => Promise<string>;
	createActionSecrets: () => GitActionSecrets;
	onChanged: (secrets: GitActionSecrets) => Promise<void>;
}

const statusOf = (error: unknown) => (error as { status?: number }).status;

/** What GitHub's refusal of a pull request means, in words. */
const pullRequestError = (
	error: unknown,
	provider: string,
	head: string,
	base: string,
): Error => {
	const message = error instanceof Error ? error.message : String(error);
	if (/no commits between/i.test(message)) {
		return new Error(
			t(
				'{head} has nothing that {base} does not have yet: there is nothing to propose.',
				{
					head,
					base,
				},
			),
		);
	}
	if (/pull request already exists/i.test(message)) {
		return new Error(
			t('A pull request for {head} is already open on {provider}.', {
				head,
				provider,
			}),
		);
	}
	const status = statusOf(error);
	if (status === 403 || status === 404) {
		return new Error(
			t(
				'{provider} refused to open the pull request: the token must be allowed to write to the repository (« repo », or « Pull requests: write » for a fine-grained token).',
				{ provider },
			),
		);
	}
	return error instanceof Error ? error : new Error(message);
};

const GitHubBranchSection: React.FC<GitHubBranchSectionProps> = ({
	provider,
	config,
	remoteName,
	projectId,
	user,
	syncStatus,
	pendingChangeCount,
	isBusy,
	busyAction,
	commitMessage,
	run,
	readToken,
	createActionSecrets,
	onChanged,
}) => {
	const pulls = provider.pullRequests;
	const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
	const [branches, setBranches] = useState<string[]>([]);
	const [pull, setPull] = useState<GitRemotePullRequest | null | undefined>();
	// Null until typed in: a free name is offered.
	const [typedName, setNewName] = useState<string | null>(null);
	const [target, setTarget] = useState('');
	const [title, setTitle] = useState('');
	const [body, setBody] = useState('');
	const [draft, setDraft] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const branch = config.branch;
	const onDefault = defaultBranch !== null && branch === defaultBranch;

	// The default branch, the branches, and the pull request of this one.
	const load = useCallback(
		async (secrets: GitActionSecrets) => {
			const token = await readToken(secrets);
			const [base, listed] = await Promise.all([
				pulls?.defaultBranch(token, config.repositoryId) ?? null,
				provider.listBranches(token, config.repositoryId),
			]);
			setDefaultBranch(base);
			setBranches(listed.map((entry) => entry.name));
			setPull(
				pulls && base !== null && base !== branch
					? await pulls.find(token, config.repositoryId, branch)
					: null,
			);
		},
		[branch, config.repositoryId, provider, pulls, readToken],
	);

	useEffect(() => {
		setPull(undefined);
		setNotice(null);
		void load(createActionSecrets()).catch(() => {
			// No token at hand, or offline: the window says so elsewhere.
			setPull(null);
		});
	}, [load, createActionSecrets]);

	if (!provider.createBranch) return null;

	const newName = typedName ?? suggestBranchName(branches);

	const nameProblem = newName.trim() ? branchNameProblem(newName.trim()) : null;
	const taken = branches.some(
		(name) => name.toLowerCase() === newName.trim().toLowerCase(),
	);
	const others = branches.filter((name) => name !== branch);
	const base = pull?.base ?? defaultBranch ?? '';
	const unpushed = pendingChangeCount > 0 || Boolean(syncStatus?.localAhead);
	// Deleted on GitHub, as it does once a pull request is merged: the
	// project's changes cannot go there any more.
	const gone = Boolean(syncStatus?.branchGone);

	const startBranch = () =>
		run('start-branch', async (secrets) => {
			const name = newName.trim();
			await gitProjectSyncService.startBranch(projectId, secrets, name);
			setNewName(null);
			setNotice(
				t(
					'The project now follows the branch {branch}: the next pushes go there. Open a pull request once it is ready.',
					{ branch: name },
				),
			);
			await onChanged(secrets);
		});

	// `carry`: the branch left is merged or deleted, so what it has that
	// is not on GitHub comes along instead of being pushed there.
	const switchTo = (name: string, carry = false) =>
		run('switch-branch', async (secrets) => {
			const result = await gitProjectSyncService.switchBranch(projectId, name, {
				secrets,
				user,
				commitMessage: commitMessage(),
				carry,
			});
			if (result.cancelled) {
				setNotice(
					t(
						'Nothing changed: the merge with the {provider} changes of {branch} was not completed.',
						{ provider: remoteName, branch: result.branch },
					),
				);
				return;
			}
			setTarget('');
			if (result.carried) {
				setNotice(
					t(
						'The project now follows {branch}. Your changes that were not on {provider} came along, merged with the files of the branch: push them to {branch} when they are ready.',
						{ branch: name, provider: remoteName },
					),
				);
				await onChanged(secrets);
				return;
			}
			setNotice(
				`${
					result.pushed?.push && result.pushed.push.pushedCommits > 0
						? `${t('Your changes were pushed to {branch} first.', {
								branch: result.pushed.push.remoteBranch,
							})} `
						: ''
				}${t(
					'The project now follows {branch}: its files are those of the branch.',
					{
						branch: name,
					},
				)}`,
			);
			await onChanged(secrets);
		});

	const recreateBranch = () =>
		run('restore-branch', async (secrets) => {
			const result = await gitProjectSyncService.recreateBranch(projectId, {
				secrets,
				user,
				commitMessage: commitMessage(),
			});
			if (!result.push) {
				throw new Error(
					t(
						'The branch was not made again: the merge with the {provider} changes was not completed.',
						{ provider: remoteName },
					),
				);
			}
			setNotice(
				t(
					'The branch {branch} was made again on {provider}, with every change of the project.',
					{ branch, provider: remoteName },
				),
			);
			await onChanged(secrets);
			await load(secrets);
		});

	const openPullRequest = () =>
		run('pull-request', async (secrets) => {
			if (!pulls || !base) return;
			if (unpushed || syncStatus?.remoteChanged) {
				const result = await gitProjectSyncService.push(projectId, {
					secrets,
					user,
					commitMessage: commitMessage(),
				});
				if (!result.push) {
					throw new Error(
						t(
							'The pull request was not opened: the merge with the {provider} changes was not completed.',
							{ provider: remoteName },
						),
					);
				}
			}
			const token = await readToken(secrets);
			try {
				const created = await pulls.create(token, config.repositoryId, {
					title: title.trim() || branch,
					body: body.trim(),
					head: branch,
					base,
					draft,
				});
				setPull(created);
				setTitle('');
				setBody('');
				setNotice(null);
			} catch (error) {
				throw pullRequestError(error, remoteName, branch, base);
			}
			await onChanged(secrets);
		});

	const pullLink = (request: GitRemotePullRequest) => (
		<a href={request.url} target='_blank' rel='noreferrer'>
			{t('See it on {provider}', { provider: remoteName })} <ExternalLinkIcon />
		</a>
	);

	const restoreButton = (
		<button
			type='button'
			className='button secondary'
			data-action='restore-branch'
			disabled={isBusy}
			onClick={() => void recreateBranch()}
		>
			{busyAction === 'restore-branch'
				? t('Creating...')
				: t('Make it again on {provider}', { provider: remoteName })}
		</button>
	);

	const renderPull = () => {
		if (!pulls || onDefault || defaultBranch === null) return null;
		if (pull === undefined) {
			return <p className='ui-note'>{t('Looking for a pull request…')}</p>;
		}
		if (pull?.state === 'open') {
			return (
				<div
					className='ui-message'
					data-tone='info'
					data-role='pull-request-open'
				>
					{t('Pull request #{number} is open, into {base}: {title}.', {
						number: pull.number,
						base: pull.base,
						title: pull.title,
					})}{' '}
					{pullLink(pull)}
					{unpushed ? (
						<p className='ui-note'>
							{t('Push your changes: they join the pull request.')}
						</p>
					) : null}
				</div>
			);
		}
		if (pull?.state === 'merged') {
			return (
				<div
					className='ui-message'
					data-tone='success'
					data-role='pull-request-merged'
				>
					<p>
						{t('Pull request #{number} was merged into {base}.', {
							number: pull.number,
							base: pull.base,
						})}{' '}
						{pullLink(pull)}
					</p>
					{gone ? (
						<p data-role='branch-gone'>
							{t('The branch {branch} no longer exists on {provider}.', {
								branch,
								provider: remoteName,
							})}
						</p>
					) : null}
					{unpushed ? (
						<p className='ui-note'>
							{t(
								'Your changes that are not on {provider} come along, to push to {base}.',
								{ provider: remoteName, base: pull.base },
							)}
						</p>
					) : null}
					<div className='ui-actions'>
						<button
							type='button'
							className='button primary'
							data-action='back-to-base'
							disabled={isBusy}
							onClick={() => void switchTo(pull.base, true)}
						>
							<GitBranchIcon />
							{busyAction === 'switch-branch'
								? t('Switching...')
								: t('Go back to {branch}', { branch: pull.base })}
						</button>
						{gone ? restoreButton : null}
					</div>
				</div>
			);
		}
		// Nothing to propose from a branch GitHub no longer has.
		if (gone) return null;
		return (
			<div className='ui-stack' data-gap='sm' data-role='pull-request-form'>
				{pull?.state === 'closed' ? (
					<p className='ui-note'>
						{t('Pull request #{number} was closed without being merged.', {
							number: pull.number,
						})}{' '}
						{pullLink(pull)}
					</p>
				) : null}
				<h4>
					{t('Propose {branch} for merging into {base}', { branch, base })}
				</h4>
				<label className='ui-field-label' htmlFor='github-pull-title'>
					{t('Title')}
				</label>
				<input
					id='github-pull-title'
					type='text'
					value={title}
					disabled={isBusy}
					placeholder={branch}
					onChange={(event) => setTitle(event.target.value)}
				/>
				<label className='ui-field-label' htmlFor='github-pull-body'>
					{t('Description')}
				</label>
				<textarea
					id='github-pull-body'
					rows={3}
					value={body}
					disabled={isBusy}
					placeholder={t('What changes, and what to look at.')}
					onChange={(event) => setBody(event.target.value)}
				/>
				<label className='checkbox-control'>
					<input
						type='checkbox'
						checked={draft}
						disabled={isBusy}
						onChange={(event) => setDraft(event.target.checked)}
					/>
					<span>{t('Draft: not ready for review yet')}</span>
				</label>
				<button
					type='button'
					className='button primary'
					data-action='open-pull-request'
					disabled={isBusy || !base}
					onClick={() => void openPullRequest()}
				>
					<GitBranchIcon />
					{busyAction === 'pull-request'
						? t('Opening...')
						: t('Open a pull request')}
				</button>
				<p className='ui-note'>
					{t(
						'What is not on {provider} yet is pushed to {branch} first. Your coauthors review the pull request on {provider}, and merge it there.',
						{ provider: remoteName, branch },
					)}
				</p>
			</div>
		);
	};

	// A merged pull request says so in its own message.
	const renderGone = () => {
		if (!gone || pull?.state === 'merged') return null;
		const back = base && base !== branch ? base : null;
		return (
			<div className='ui-message' data-tone='warning' data-role='branch-gone'>
				<p>
					{t('The branch {branch} no longer exists on {provider}.', {
						branch,
						provider: remoteName,
					})}{' '}
					{t('It may have been deleted once its pull request was merged.')}
				</p>
				<p className='ui-note'>
					{t(
						'Nothing is lost: the project keeps its files and its history. Go back to another branch with them, or make this one again on {provider}.',
						{ provider: remoteName },
					)}
				</p>
				<div className='ui-actions'>
					{back ? (
						<button
							type='button'
							className='button primary'
							data-action='leave-gone-branch'
							disabled={isBusy}
							onClick={() => void switchTo(back, true)}
						>
							<GitBranchIcon />
							{busyAction === 'switch-branch'
								? t('Switching...')
								: t('Go back to {branch}', { branch: back })}
						</button>
					) : null}
					{restoreButton}
				</div>
			</div>
		);
	};

	return (
		<section
			className='ui-card ui-stack'
			data-gap='sm'
			data-padding='md'
			data-surface='secondary'
			data-role='github-branch'
		>
			<h3>{t('Branch')}</h3>
			<p data-role='current-branch'>
				{t('The project follows the branch')}{' '}
				<span className='ui-badge' data-variant='label'>
					{branch}
				</span>
				{onDefault ? ` ${t('(the default branch)')}` : ''}
			</p>
			{notice ? (
				<div
					className='ui-message'
					data-tone='success'
					data-role='branch-notice'
				>
					{notice}
				</div>
			) : null}
			{renderGone()}
			{renderPull()}

			<details className='github-sync-branch' data-role='new-branch'>
				<summary>{t('Work on a new branch')}</summary>
				<div className='ui-stack' data-gap='sm'>
					<p className='ui-note'>
						{t(
							'The branch starts from {branch} on {provider}. The files do not change; the next pushes go to the new branch, which a pull request can then propose for merging.',
							{ branch, provider: remoteName },
						)}
					</p>
					<label className='ui-field-label' htmlFor='github-new-branch'>
						{t('Name of the branch')}
					</label>
					<input
						id='github-new-branch'
						type='text'
						value={newName}
						disabled={isBusy}
						onChange={(event) => setNewName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && !nameProblem && !taken)
								void startBranch();
						}}
					/>
					{nameProblem || taken ? (
						<p
							className='ui-note'
							data-tone='warning'
							data-role='branch-name-problem'
						>
							{nameProblem ?? t('This branch already exists: choose it below.')}
						</p>
					) : null}
					<button
						type='button'
						className='button secondary'
						data-action='start-branch'
						disabled={
							isBusy || !newName.trim() || Boolean(nameProblem) || taken
						}
						onClick={() => void startBranch()}
					>
						<GitBranchIcon />
						{busyAction === 'start-branch'
							? t('Creating...')
							: t('Create the branch and follow it')}
					</button>
				</div>
			</details>

			{others.length > 0 ? (
				<details className='github-sync-branch' data-role='switch-branch'>
					<summary>{t('Switch to another branch')}</summary>
					<div className='ui-stack' data-gap='sm'>
						<p className='ui-note'>
							{gone
								? t(
										'What is not on {provider} yet comes along, merged with the files of the branch chosen, for every collaborator.',
										{ provider: remoteName },
									)
								: t(
										'What is not on {provider} yet is pushed to {branch} first; then the project’s files become those of the branch chosen, for every collaborator.',
										{ provider: remoteName, branch },
									)}
						</p>
						<select
							className='ui-field-control'
							value={target}
							disabled={isBusy}
							aria-label={t('Branch')}
							onChange={(event) => setTarget(event.target.value)}
						>
							<option value=''>{t('Choose a branch')}</option>
							{others.map((name) => (
								<option key={name} value={name}>
									{name}
									{name === defaultBranch
										? ` ${t('(the default branch)')}`
										: ''}
								</option>
							))}
						</select>
						<button
							type='button'
							className='button secondary'
							data-action='switch-branch'
							disabled={isBusy || !target}
							onClick={() => void switchTo(target, gone)}
						>
							<GitBranchIcon />
							{busyAction === 'switch-branch'
								? t('Switching...')
								: t('Switch to this branch')}
						</button>
					</div>
				</details>
			) : null}
		</section>
	);
};

export default GitHubBranchSection;
