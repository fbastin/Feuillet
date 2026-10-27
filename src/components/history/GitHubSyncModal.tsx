// src/components/history/GitHubSyncModal.tsx
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { useAuth } from '@/hooks/useAuth';
import {
	type GitActionSecrets,
	useGitRemoteAccount,
} from '@/hooks/useGitRemoteAccount';
import { useSecrets } from '@/hooks/useSecrets';
import { useSettings } from '@/hooks/useSettings';
import {
	DownloadIcon,
	ExternalLinkIcon,
	GitPushIcon,
	UnlinkIcon,
} from '@/components/common/Icons';
import Modal from '@/components/common/Modal';
import { fileStoreService } from '@/services/FileStoreService';
import { gitFileSystemService } from '@/services/GitFileSystemService';
import {
	type GitProjectPullResult,
	gitProjectSyncService,
} from '@/services/GitProjectSyncService';
import { gitService } from '@/services/GitService';
import { projectSeedService } from '@/services/ProjectSeedService';
import {
	type GitRemoteSyncStatus,
	gitSyncService,
} from '@/services/GitSyncService';
import type {
	GitRemoteBranch,
	GitRemoteConfig,
	GitRemoteProvider,
	GitRemoteRepository,
} from '@/types/gitRemote';
import type { SharedGitRemote } from '@/types/documents';
import type { PendingGitImport } from '@/utils/gitPendingImport';
import { ensureGitRemoteBranch } from '@/utils/gitUtils';
import GitAccountTokenForm from './GitAccountTokenForm';
import GitRepositoryPicker, {
	type GitRepositorySelection,
} from './GitRepositoryPicker';

const moduleLog = createNamedLogger('GitHubSyncModal');

const NEW_REPOSITORY_RETRIES = 4;
const NEW_REPOSITORY_RETRY_DELAY_MS = 1500;

interface GitHubSyncModalProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	projectName: string;
	projectDescription: string;
	provider: GitRemoteProvider;
	icon: React.ComponentType;
	pendingImport?: PendingGitImport | null;
	// The repository a collaborator linked the project to.
	sharedRemote?: SharedGitRemote;
}

type LinkMode = 'create' | 'existing';

const defaultCommitMessage = () => t('Update on {app}.', { app: APP_NAME });

const repositoryNameFromProject = (name: string): string =>
	name
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '')
		.slice(0, 100) || 'latex-project';

const errorMessage = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback;

const isFreshRepositoryError = (error: unknown): boolean => {
	const status = (error as { status?: number }).status;
	return status === 404 || status === 409;
};

const wait = (ms: number) =>
	new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const GitHubSyncModal: React.FC<GitHubSyncModalProps> = ({
	isOpen,
	onClose,
	projectId,
	projectName,
	projectDescription,
	provider,
	icon: ProviderIcon,
	pendingImport,
	sharedRemote,
}) => {
	const { user } = useAuth();
	const { removeSecret } = useSecrets();
	const { getSetting } = useSettings();
	const fileSystem = useMemo(
		() => gitFileSystemService.get(projectId),
		[projectId],
	);

	const [remote, setRemote] = useState<GitRemoteConfig | undefined>(() =>
		gitSyncService.getConfig(projectId),
	);
	const gitAccount = useGitRemoteAccount(provider, isOpen && !remote);
	const { account, createActionSecrets, readToken } = gitAccount;
	const [showTokenForm, setShowTokenForm] = useState(false);

	const [linkMode, setLinkMode] = useState<LinkMode>('create');
	const [repositoryName, setRepositoryName] = useState(() =>
		repositoryNameFromProject(projectName),
	);
	const [repositoryDescription, setRepositoryDescription] =
		useState(projectDescription);
	const [isPrivate, setIsPrivate] = useState(true);
	const [selection, setSelection] = useState<GitRepositorySelection | null>(
		null,
	);
	const [cleanAnnotations, setCleanAnnotations] = useState(true);
	const [linkAnother, setLinkAnother] = useState(false);

	const [commitMessage, setCommitMessage] = useState('');
	const [syncStatus, setSyncStatus] = useState<GitRemoteSyncStatus | null>(
		null,
	);
	const [pendingChangeCount, setPendingChangeCount] = useState(0);

	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const importStartedRef = useRef(false);

	const isBusy = busyAction !== null || gitAccount.isLoading;
	const remoteName = remote?.providerName ?? provider.displayName;
	const storesGitOnDisk = fileSystem.getSettings().storeGitOnDisk;

	useEffect(() => {
		provider.configure?.(getSetting);
	}, [getSetting, provider]);

	useEffect(() => {
		setRemote(gitSyncService.getConfig(projectId));
		return gitSyncService.addListener(projectId, setRemote);
	}, [projectId]);

	const run = async (
		label: string,
		action: (secrets: GitActionSecrets) => Promise<void>,
	): Promise<boolean> => {
		setBusyAction(label);
		setError(null);
		setNotice(null);
		try {
			await action(createActionSecrets());
			return true;
		} catch (actionError) {
			moduleLog.error(`GitHub action "${label}" failed:`, actionError);
			setError(errorMessage(actionError, t('Git action failed')));
			return false;
		} finally {
			setBusyAction(null);
		}
	};

	const refreshStatus = useCallback(
		async (secrets: GitActionSecrets = createActionSecrets()) => {
			if (!gitSyncService.getConfig(projectId)) return;
			if (await gitService.isInitialized(projectId)) {
				setPendingChangeCount((await gitService.getChanges(projectId)).length);
			}
			setSyncStatus(await gitSyncService.getSyncStatus(projectId, secrets));
		},
		[createActionSecrets, projectId],
	);

	const linkedTarget = remote
		? `${remote.providerId}:${remote.repositoryId}:${remote.branch}`
		: null;

	// Keyed on the link target so sync-base updates after push/pull do not reload it twice.
	useEffect(() => {
		if (!isOpen || !linkedTarget) return;
		setSyncStatus(null);
		void refreshStatus(createActionSecrets()).catch((statusError) => {
			moduleLog.warn('Failed to load GitHub sync status:', statusError);
			setError(
				errorMessage(statusError, t('Failed to load Git remote status')),
			);
		});
	}, [createActionSecrets, isOpen, refreshStatus, linkedTarget]);

	const connectRepository = async (
		secrets: GitActionSecrets,
		repository: GitRemoteRepository,
		ref: string,
		clean: boolean,
	) => {
		await gitSyncService.connect(
			projectId,
			{
				providerId: provider.id,
				repositoryId: repository.id,
				repositoryLabel: repository.label,
				branch: ref,
			},
			{ source: 'backup-global', token: '' },
			secrets,
		);
		if (!storesGitOnDisk) fileSystem.setGitCleanAnnotations(clean);
	};

	const pushToNewRepository = async (secrets: GitActionSecrets) => {
		for (let attempt = 1; ; attempt++) {
			try {
				return await gitProjectSyncService.push(projectId, {
					secrets,
					user,
					commitMessage: t('Initial commit from {app}', { app: APP_NAME }),
				});
			} catch (pushError) {
				if (
					attempt >= NEW_REPOSITORY_RETRIES ||
					!isFreshRepositoryError(pushError)
				) {
					throw pushError;
				}
				await wait(NEW_REPOSITORY_RETRY_DELAY_MS);
			}
		}
	};

	const createRepository = () =>
		run('create', async (secrets) => {
			if (!provider.createRepository) return;
			const name = repositoryName.trim();
			if (!name) throw new Error(t('Repository name is required'));
			const repository = await provider.createRepository(
				await readToken(secrets),
				{
					name,
					description: repositoryDescription.trim(),
					private: isPrivate,
				},
			);
			await connectRepository(
				secrets,
				repository,
				repository.defaultBranch || 'main',
				cleanAnnotations,
			);

			await gitProjectSyncService.commitPendingChanges(
				projectId,
				t('Initial commit from {app}', { app: APP_NAME }),
				user,
			);
			if (await gitService.getHeadOid(projectId)) {
				await pushToNewRepository(secrets);
				setNotice(
					t('Created {repository} and pushed this project to it.', {
						repository: repository.label,
					}),
				);
			} else {
				setNotice(
					t('Created {repository}. Add files, then push them to {provider}.', {
						repository: repository.label,
						provider: provider.displayName,
					}),
				);
			}
		});

	const linkRepository = (
		repository: GitRemoteRepository,
		ref: string,
		knownBranches: GitRemoteBranch[],
		clean: boolean,
	) =>
		run('link', async (secrets) => {
			await ensureGitRemoteBranch(
				provider,
				await readToken(secrets),
				repository.id,
				ref,
				knownBranches,
				repository.defaultBranch,
			);
			await connectRepository(secrets, repository, ref, clean);

			const pulled = await gitProjectSyncService.pullWithLocalChanges(
				projectId,
				{
					secrets,
					user,
					commitMessage: defaultCommitMessage(),
				},
			);
			if (pulled.status === 'empty-remote') {
				if (await gitService.getHeadOid(projectId)) {
					await gitProjectSyncService.push(projectId, {
						secrets,
						user,
						commitMessage: defaultCommitMessage(),
					});
				}
				setNotice(
					t('Linked {repository} and pushed this project to it.', {
						repository: repository.label,
					}),
				);
				return;
			}
			setNotice(
				pulled.status === 'cancelled'
					? t(
							'Linked {repository}. The merge was cancelled; pull again when you are ready.',
							{ repository: repository.label },
						)
					: t('Linked {repository} and pulled its files.', {
							repository: repository.label,
						}),
			);
		});

	// The project already lives in the repository: this device continues
	// from the commit it was last synced as, then catches up.
	const joinSharedRepository = (shared: SharedGitRemote) =>
		void run('link', async (secrets) => {
			const repository = {
				id: shared.repositoryId,
				label: shared.repositoryLabel,
			};
			await connectRepository(
				secrets,
				repository,
				shared.branch,
				cleanAnnotations,
			);
			await gitSyncService.adoptRemoteBase(
				projectId,
				secrets,
				shared.syncedCommit,
			);
			const pulled = await gitProjectSyncService.pullWithLocalChanges(
				projectId,
				{ secrets, user, commitMessage: defaultCommitMessage() },
			);
			setNotice(
				pulled.status === 'cancelled'
					? t(
							'Linked {repository}. The merge was cancelled; pull again when you are ready.',
							{ repository: repository.label },
						)
					: t('Linked {repository} and pulled its files.', {
							repository: repository.label,
						}),
			);
		});

	const linkSelectedRepository = () => {
		if (!selection) {
			setError(t('Choose a repository and a branch'));
			return;
		}
		void linkRepository(
			selection.repository,
			selection.branch,
			selection.branches,
			cleanAnnotations,
		);
	};

	// Overleaf-style landing after an import: open the main document.
	const openMainFile = async () => {
		const files = await fileStoreService.getAllFiles(false, true, true);
		const mainFile = projectSeedService.findMainFile(
			files,
			projectSeedService.detectProjectType(files),
		);
		if (mainFile) {
			document.dispatchEvent(
				new CustomEvent('navigate-to-compiled-file', {
					detail: { filePath: mainFile },
				}),
			);
		}
	};

	/* biome-ignore lint/correctness/useExhaustiveDependencies: The pending import runs once, when the editor first opens the imported project. */
	useEffect(() => {
		if (!isOpen || !pendingImport || remote || importStartedRef.current) return;
		importStartedRef.current = true;
		void linkRepository(
			pendingImport.repository,
			pendingImport.branch,
			[],
			pendingImport.cleanAnnotations,
		).then(async (linked) => {
			if (!linked) return;
			await openMainFile().catch((openError) => {
				moduleLog.warn('Failed to open the imported main file:', openError);
			});
			onClose();
		});
	}, [isOpen, pendingImport, remote]);

	const pullNotice = (
		result: GitProjectPullResult,
		committed: boolean,
	): string => {
		const saved = committed
			? `${t('Your edits were saved as a commit first.')} `
			: '';
		switch (result.status) {
			case 'empty-remote':
				return t('The {provider} repository is empty. Push to initialize it.', {
					provider: remoteName,
				});
			case 'cancelled':
				return `${saved}${t('Pull cancelled.')}`;
			case 'up-to-date':
				return `${saved}${t('Already up to date with {provider}.', {
					provider: remoteName,
				})}`;
			case 'merged':
				return `${saved}${t('Merged the changes from {remote}.', {
					remote: result.remoteLabel,
				})}`;
			default:
				return `${saved}${t('Pulled the changes from {remote}.', {
					remote: result.remoteLabel,
				})}`;
		}
	};

	const pushChanges = () =>
		run('push', async (secrets) => {
			const result = await gitProjectSyncService.push(projectId, {
				secrets,
				user,
				commitMessage: commitMessage.trim() || defaultCommitMessage(),
			});
			if (!result.push) {
				setNotice(
					t(
						'Push cancelled because the merge with the {provider} changes was not completed.',
						{ provider: remoteName },
					),
				);
				return;
			}
			setCommitMessage('');
			const merged =
				result.pull && result.pull.status !== 'empty-remote'
					? `${t('The {provider} changes were merged first.', {
							provider: remoteName,
						})} `
					: '';
			setNotice(
				result.push.pushedCommits === 0
					? t('Everything is already on {provider}.', {
							provider: remoteName,
						})
					: `${merged}${t('Pushed {count} commits to {repository}.', {
							count: result.push.pushedCommits,
							repository: result.push.repositoryLabel,
						})}`,
			);
			await refreshStatus(secrets);
		});

	const pullChanges = () =>
		run('pull', async (secrets) => {
			const result = await gitProjectSyncService.pullWithLocalChanges(
				projectId,
				{
					secrets,
					user,
					commitMessage: commitMessage.trim() || defaultCommitMessage(),
				},
			);
			setNotice(pullNotice(result, Boolean(result.committedOid)));
			await refreshStatus(secrets);
		});

	const unlink = () =>
		run('unlink', async () => {
			await gitSyncService.disconnect(projectId, { removeSecret });
			setSyncStatus(null);
			setSelection(null);
			setNotice(
				t(
					'The repository was unlinked. The project and its history were not changed.',
				),
			);
		});

	const repositoryUrl =
		remote?.providerId === provider.id && provider.getRepositoryUrl
			? provider.getRepositoryUrl(remote.repositoryId)
			: null;

	const renderMessages = () => (
		<>
			{busyAction === 'link' && pendingImport ? (
				<div className='ui-message' data-tone='info'>
					{t('Importing {repository}...', {
						repository: pendingImport.repository.label,
					})}
				</div>
			) : null}
			{error || gitAccount.error ? (
				<div className='ui-message' data-tone='error'>
					{error ?? gitAccount.error}
				</div>
			) : null}
			{notice ? (
				<div className='ui-message' data-tone='success'>
					{notice}
				</div>
			) : null}
		</>
	);

	const renderTokenForm = () => (
		<GitAccountTokenForm
			provider={provider}
			isBusy={isBusy}
			onCancel={gitAccount.hasToken ? () => setShowTokenForm(false) : undefined}
			onSubmit={async (value) => {
				const connected = await run('token', () =>
					gitAccount.connectToken(value),
				);
				if (connected) setShowTokenForm(false);
				return connected;
			}}
		/>
	);

	const renderAccountLine = () => (
		<div className='github-sync-account ui-meta' data-layout='row'>
			<span>
				{account
					? t('Signed in to {provider} as {login}', {
							provider: provider.displayName,
							login: account.login,
						})
					: gitAccount.isLoading
						? t('Checking your {provider} account...', {
								provider: provider.displayName,
							})
						: t('{provider} account connected', {
								provider: provider.displayName,
							})}
			</span>
			<button
				type='button'
				className='git-history-inline-action'
				disabled={isBusy}
				onClick={() => setShowTokenForm(true)}
			>
				{t('Change token')}
			</button>
		</div>
	);

	const renderAnnotationOption = () =>
		storesGitOnDisk ? null : (
			<label className='checkbox-control'>
				<input
					type='checkbox'
					checked={cleanAnnotations}
					disabled={isBusy}
					onChange={(event) => setCleanAnnotations(event.target.checked)}
				/>
				<span>
					{t('Keep comments and tracked changes out of {provider}', {
						provider: provider.displayName,
					})}
				</span>
			</label>
		);

	const renderCreateForm = () => (
		<div className='ui-stack' data-gap='sm'>
			<label className='ui-field-label' htmlFor='github-sync-repo-name'>
				{t('Repository name')}
			</label>
			<input
				id='github-sync-repo-name'
				type='text'
				value={repositoryName}
				disabled={isBusy}
				onChange={(event) => setRepositoryName(event.target.value)}
			/>
			<label className='ui-field-label' htmlFor='github-sync-repo-description'>
				{t('Description (optional)')}
			</label>
			<input
				id='github-sync-repo-description'
				type='text'
				value={repositoryDescription}
				disabled={isBusy}
				onChange={(event) => setRepositoryDescription(event.target.value)}
			/>
			<div className='ui-actions' data-wrap='true'>
				<label className='checkbox-control'>
					<input
						type='radio'
						name='github-sync-visibility'
						checked={isPrivate}
						disabled={isBusy}
						onChange={() => setIsPrivate(true)}
					/>
					<span>{t('Private')}</span>
				</label>
				<label className='checkbox-control'>
					<input
						type='radio'
						name='github-sync-visibility'
						checked={!isPrivate}
						disabled={isBusy}
						onChange={() => setIsPrivate(false)}
					/>
					<span>{t('Public')}</span>
				</label>
			</div>
			{renderAnnotationOption()}
			<button
				type='button'
				className='button primary'
				disabled={isBusy || !repositoryName.trim()}
				onClick={() => void createRepository()}
			>
				{busyAction === 'create'
					? t('Creating repository...')
					: t('Create repository and push')}
			</button>
		</div>
	);

	const renderExistingForm = () => (
		<div className='ui-stack' data-gap='sm'>
			<GitRepositoryPicker
				provider={provider}
				readToken={() => readToken(createActionSecrets())}
				disabled={isBusy}
				onChange={setSelection}
				onError={setError}
			/>
			{selection ? (
				<>
					{renderAnnotationOption()}
					<p className='ui-note'>
						{t(
							'Linking pulls the repository into this project. If both contain files, they are merged and you can resolve any conflicts.',
						)}
					</p>
					<button
						type='button'
						className='button primary'
						disabled={isBusy}
						onClick={linkSelectedRepository}
					>
						{busyAction === 'link'
							? t('Linking...')
							: t('Link repository and pull')}
					</button>
				</>
			) : null}
		</div>
	);

	const renderLinkForm = () => (
		<section
			className='ui-card ui-stack'
			data-gap='md'
			data-padding='md'
			data-surface='secondary'
		>
			{renderAccountLine()}
			<div className='ui-actions' data-wrap='true'>
				{provider.createRepository ? (
					<label className='checkbox-control'>
						<input
							type='radio'
							name='github-sync-link-mode'
							checked={linkMode === 'create'}
							disabled={isBusy}
							onChange={() => setLinkMode('create')}
						/>
						<span>{t('Create a new repository')}</span>
					</label>
				) : null}
				<label className='checkbox-control'>
					<input
						type='radio'
						name='github-sync-link-mode'
						checked={linkMode === 'existing' || !provider.createRepository}
						disabled={isBusy}
						onChange={() => setLinkMode('existing')}
					/>
					<span>{t('Use an existing repository')}</span>
				</label>
			</div>
			{linkMode === 'create' && provider.createRepository
				? renderCreateForm()
				: renderExistingForm()}
		</section>
	);

	const renderStatus = () => {
		if (!syncStatus) {
			return (
				<p className='ui-note'>
					{t('Checking {provider} status...', { provider: remoteName })}
				</p>
			);
		}
		const lines: string[] = [];
		if (pendingChangeCount > 0) {
			lines.push(
				t('{count} files changed since the last commit.', {
					count: pendingChangeCount,
				}),
			);
		}
		if (syncStatus.localAhead) {
			lines.push(
				t('This project has commits that are not on {provider} yet.', {
					provider: remoteName,
				}),
			);
		}
		if (syncStatus.remoteChanged) {
			lines.push(
				t('{provider} has changes that are not in this project yet.', {
					provider: remoteName,
				}),
			);
		}
		if (lines.length === 0) {
			lines.push(t('Up to date with {provider}.', { provider: remoteName }));
		}
		return (
			<ul className='github-sync-status'>
				{lines.map((line) => (
					<li key={line}>{line}</li>
				))}
			</ul>
		);
	};

	const renderLinked = (config: GitRemoteConfig) => (
		<>
			<section
				className='ui-card ui-stack'
				data-gap='sm'
				data-padding='md'
				data-surface='secondary'
			>
				<div className='github-sync-repository'>
					<ProviderIcon />
					{repositoryUrl ? (
						<a href={repositoryUrl} target='_blank' rel='noreferrer'>
							<strong>{config.repositoryLabel}</strong> <ExternalLinkIcon />
						</a>
					) : (
						<strong>{config.repositoryLabel}</strong>
					)}
					<span className='ui-badge' data-variant='label'>
						{config.branch}
					</span>
				</div>
				{renderStatus()}
			</section>

			<section
				className='ui-card ui-stack'
				data-gap='sm'
				data-padding='md'
				data-surface='secondary'
			>
				<h3>
					{t('Push {app} changes to {provider}', {
						app: APP_NAME,
						provider: remoteName,
					})}
				</h3>
				<label className='ui-field-label' htmlFor='github-sync-message'>
					{t('Commit message')}
				</label>
				<input
					id='github-sync-message'
					type='text'
					value={commitMessage}
					disabled={isBusy}
					placeholder={defaultCommitMessage()}
					onChange={(event) => setCommitMessage(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') void pushChanges();
					}}
				/>
				<button
					type='button'
					className='button primary'
					disabled={isBusy}
					onClick={() => void pushChanges()}
				>
					<GitPushIcon />
					{busyAction === 'push'
						? t('Pushing...')
						: t('Push to {provider}', {
								provider: remoteName,
							})}
				</button>
			</section>

			<section
				className='ui-card ui-stack'
				data-gap='sm'
				data-padding='md'
				data-surface='secondary'
			>
				<h3>
					{t('Pull {provider} changes into {app}', {
						app: APP_NAME,
						provider: remoteName,
					})}
				</h3>
				<p className='ui-note'>
					{t(
						'Your edits are committed first and then merged with the changes from the repository. Conflicting lines open in the merge editor.',
					)}
				</p>
				<button
					type='button'
					className='button secondary'
					disabled={isBusy}
					onClick={() => void pullChanges()}
				>
					<DownloadIcon />
					{busyAction === 'pull'
						? t('Pulling...')
						: t('Pull from {provider}', {
								provider: remoteName,
							})}
				</button>
			</section>

			<div className='github-sync-footer ui-stack' data-gap='sm'>
				<p className='ui-note'>
					{t(
						'The link and the Git history are stored in this browser. Collaborators who want to push or pull link the same repository from their own browser. Branches and the full history are in the History tab.',
					)}
				</p>
				<button
					type='button'
					className='button secondary'
					disabled={isBusy}
					onClick={() => void unlink()}
				>
					<UnlinkIcon />
					{t('Unlink repository')}
				</button>
			</div>
		</>
	);

	// Joining the repository a collaborator linked: this device syncs with
	// it through the user's own account.
	const renderSharedForm = (shared: SharedGitRemote) => (
		<section
			className='ui-card ui-stack'
			data-gap='md'
			data-padding='md'
			data-surface='secondary'
		>
			{renderAccountLine()}
			<p className='github-sync-shared'>
				{t(
					'This project is linked to {repository} ({branch}). Link it here too to sync with your own {provider} account.',
					{
						repository: shared.repositoryLabel,
						branch: shared.branch,
						provider: provider.displayName,
					},
				)}
			</p>
			{renderAnnotationOption()}
			<div className='ui-actions' data-wrap='true'>
				<button
					type='button'
					className='button primary'
					disabled={isBusy}
					onClick={() => joinSharedRepository(shared)}
				>
					{busyAction === 'link'
						? t('Linking...')
						: t('Link repository and pull')}
				</button>
				<button
					type='button'
					className='git-history-inline-action'
					disabled={isBusy}
					onClick={() => setLinkAnother(true)}
				>
					{t('Link another repository')}
				</button>
			</div>
		</section>
	);

	const renderBody = () => {
		if (remote) return renderLinked(remote);
		if (pendingImport && !error) return null;
		if (!gitAccount.hasToken || showTokenForm) return renderTokenForm();
		if (
			sharedRemote &&
			sharedRemote.providerId === provider.id &&
			!linkAnother
		) {
			return renderSharedForm(sharedRemote);
		}
		return renderLinkForm();
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={provider.displayName}
			icon={ProviderIcon}
			size='medium'
		>
			<div className='github-sync-modal ui-stack' data-gap='md'>
				{renderMessages()}
				{renderBody()}
			</div>
		</Modal>
	);
};

export default GitHubSyncModal;
