// src/components/history/GitHubSyncModal.tsx
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { useAuth } from '@/hooks/useAuth';
import { useSecrets } from '@/hooks/useSecrets';
import { useSettings } from '@/hooks/useSettings';
import {
	DownloadIcon,
	ExternalLinkIcon,
	GitPushIcon,
	KeyIcon,
	UnlinkIcon,
} from '@/components/common/Icons';
import Modal from '@/components/common/Modal';
import type { SecretsContextType } from '@/contexts/SecretsContext';
import { gitFileSystemService } from '@/services/GitFileSystemService';
import {
	type GitProjectPullResult,
	gitProjectSyncService,
} from '@/services/GitProjectSyncService';
import { gitService } from '@/services/GitService';
import {
	type GitRemoteSyncStatus,
	gitSyncService,
} from '@/services/GitSyncService';
import type {
	GitRemoteAccount,
	GitRemoteBranch,
	GitRemoteConfig,
	GitRemoteProvider,
	GitRemoteRepository,
} from '@/types/gitRemote';
import { ensureGitRemoteBranch } from '@/utils/gitUtils';

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
}

type LinkMode = 'create' | 'existing';

type ActionSecrets = Pick<SecretsContextType, 'getSecret' | 'setSecret'>;

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
}) => {
	const { user } = useAuth();
	const { getSecret, setSecret, hasSecret, removeSecret } = useSecrets();
	const { getSetting } = useSettings();
	const fileSystem = useMemo(
		() => gitFileSystemService.get(projectId),
		[projectId],
	);

	const [remote, setRemote] = useState<GitRemoteConfig | undefined>(() =>
		gitSyncService.getConfig(projectId),
	);
	const [hasAccountToken, setHasAccountToken] = useState(false);
	const [account, setAccount] = useState<GitRemoteAccount | null>(null);
	const [showTokenForm, setShowTokenForm] = useState(false);
	const [token, setToken] = useState('');

	const [linkMode, setLinkMode] = useState<LinkMode>('create');
	const [repositoryName, setRepositoryName] = useState(() =>
		repositoryNameFromProject(projectName),
	);
	const [repositoryDescription, setRepositoryDescription] =
		useState(projectDescription);
	const [isPrivate, setIsPrivate] = useState(true);
	const [repositories, setRepositories] = useState<GitRemoteRepository[]>([]);
	const [repositoryQuery, setRepositoryQuery] = useState('');
	const [repositoryId, setRepositoryId] = useState('');
	const [branches, setBranches] = useState<GitRemoteBranch[]>([]);
	const [branch, setBranch] = useState('');
	const [cleanAnnotations, setCleanAnnotations] = useState(true);

	const [commitMessage, setCommitMessage] = useState('');
	const [syncStatus, setSyncStatus] = useState<GitRemoteSyncStatus | null>(
		null,
	);
	const [pendingChangeCount, setPendingChangeCount] = useState(0);

	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const isBusy = busyAction !== null;
	const remoteName = remote?.providerName ?? provider.displayName;
	const storesGitOnDisk = fileSystem.getSettings().storeGitOnDisk;

	useEffect(() => {
		provider.configure?.(getSetting);
	}, [getSetting, provider]);

	useEffect(() => {
		setRemote(gitSyncService.getConfig(projectId));
		return gitSyncService.addListener(projectId, setRemote);
	}, [projectId]);

	/* biome-ignore lint/correctness/useExhaustiveDependencies(isOpen): Reopening the modal re-reads the stored account credential. */
	useEffect(() => {
		setHasAccountToken(
			hasSecret(provider.backupPluginId, provider.backupTokenSecretKey, {
				scope: 'global',
			}),
		);
	}, [hasSecret, isOpen, provider]);

	// One action can read the same secret several times (status, push, ...).
	// Sharing the reads asks for the account password at most once per action.
	const createActionSecrets = useCallback((): ActionSecrets => {
		const reads = new Map<string, ReturnType<typeof getSecret>>();
		return {
			getSecret: (pluginId, secretKey, options) => {
				const key = [
					pluginId,
					secretKey,
					options?.scope ?? 'global',
					options?.projectId ?? '',
				].join('\u0000');
				let read = reads.get(key);
				if (!read) {
					read = getSecret(pluginId, secretKey, options);
					reads.set(key, read);
				}
				return read;
			},
			setSecret,
		};
	}, [getSecret, setSecret]);

	const run = async (
		label: string,
		action: (secrets: ActionSecrets) => Promise<void>,
	) => {
		setBusyAction(label);
		setError(null);
		setNotice(null);
		try {
			await action(createActionSecrets());
		} catch (actionError) {
			moduleLog.error(`GitHub action "${label}" failed:`, actionError);
			setError(errorMessage(actionError, t('Git action failed')));
		} finally {
			setBusyAction(null);
		}
	};

	const readAccountToken = useCallback(
		async (secrets: ActionSecrets): Promise<string> => {
			const secret = await secrets.getSecret(
				provider.backupPluginId,
				provider.backupTokenSecretKey,
				{ scope: 'global' },
			);
			const value = secret?.value?.trim();
			if (!value) {
				throw new Error(
					t('Your {provider} token is unavailable. Enter it again.', {
						provider: provider.displayName,
					}),
				);
			}
			return value;
		},
		[provider],
	);

	const accountForToken = useCallback(
		async (accountToken: string): Promise<GitRemoteAccount> => {
			if (provider.getAccount) return provider.getAccount(accountToken);
			if (!(await provider.testConnection(accountToken))) {
				throw new Error(
					t('{provider} did not accept the saved token.', {
						provider: provider.displayName,
					}),
				);
			}
			return { login: provider.displayName };
		},
		[provider],
	);

	useEffect(() => {
		if (!isOpen || remote || !hasAccountToken || account) return;
		let active = true;
		setBusyAction('account');
		readAccountToken(createActionSecrets())
			.then(accountForToken)
			.then((loaded) => {
				if (active) setAccount(loaded);
			})
			.catch((accountError) => {
				if (active) {
					setError(errorMessage(accountError, t('Git action failed')));
				}
			})
			.finally(() => {
				if (active) setBusyAction(null);
			});
		return () => {
			active = false;
		};
	}, [
		account,
		accountForToken,
		createActionSecrets,
		hasAccountToken,
		isOpen,
		readAccountToken,
		remote,
	]);

	const refreshStatus = useCallback(
		async (secrets: ActionSecrets = createActionSecrets()) => {
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

	const saveToken = () =>
		run('token', async (secrets) => {
			const value = token.trim();
			if (!value) throw new Error(t('A credential is required'));
			if (!(await provider.testConnection(value))) {
				throw new Error(
					t('{provider} did not accept this token.', {
						provider: provider.displayName,
					}),
				);
			}
			await secrets.setSecret(
				provider.backupPluginId,
				provider.backupTokenSecretKey,
				value,
				{
					scope: 'global',
					metadata: { tokenType: `${provider.id}-personal-access-token` },
				},
			);
			const connected = await accountForToken(value);
			setToken('');
			setShowTokenForm(false);
			setAccount(connected);
			setHasAccountToken(true);
		});

	const loadRepositories = () =>
		run('repositories', async (secrets) => {
			const loaded = await provider.listRepositories(
				await readAccountToken(secrets),
			);
			setRepositories(loaded);
		});

	const selectRepository = (nextId: string) =>
		run('branches', async (secrets) => {
			setRepositoryId(nextId);
			setBranches([]);
			setBranch('');
			if (!nextId) return;
			const loaded = await provider.listBranches(
				await readAccountToken(secrets),
				nextId,
			);
			const repository = repositories.find((item) => item.id === nextId);
			setBranches(loaded);
			setBranch(
				loaded.find((item) => item.name === repository?.defaultBranch)?.name ??
					loaded.find((item) => item.name === 'main')?.name ??
					loaded.find((item) => item.name === 'master')?.name ??
					loaded[0]?.name ??
					repository?.defaultBranch ??
					'main',
			);
		});

	const applyAnnotationSetting = () => {
		if (!storesGitOnDisk) fileSystem.setGitCleanAnnotations(cleanAnnotations);
	};

	const connectRepository = async (
		secrets: ActionSecrets,
		repository: GitRemoteRepository,
		ref: string,
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
		applyAnnotationSetting();
	};

	const pushToNewRepository = async (secrets: ActionSecrets) => {
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
				await readAccountToken(secrets),
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

	const normalizedQuery = provider.normalizeRepositoryInput
		? provider.normalizeRepositoryInput(repositoryQuery)
		: repositoryQuery.trim();
	const filteredRepositories = repositories.filter((item) =>
		item.label.toLowerCase().includes(repositoryQuery.trim().toLowerCase()),
	);
	const selectedRepository: GitRemoteRepository | null = repositoryId
		? (repositories.find((item) => item.id === repositoryId) ?? {
				id: repositoryId,
				label: repositoryId,
			})
		: null;

	const linkExistingRepository = () =>
		run('link', async (secrets) => {
			if (!selectedRepository || !branch.trim()) {
				throw new Error(t('Choose a repository and a branch'));
			}
			const ref = branch.trim();
			await ensureGitRemoteBranch(
				provider,
				await readAccountToken(secrets),
				selectedRepository.id,
				ref,
				branches,
				selectedRepository.defaultBranch,
			);
			await connectRepository(secrets, selectedRepository, ref);

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
						repository: selectedRepository.label,
					}),
				);
				return;
			}
			setNotice(
				pulled.status === 'cancelled'
					? t(
							'Linked {repository}. The merge was cancelled; pull again when you are ready.',
							{ repository: selectedRepository.label },
						)
					: t('Linked {repository} and pulled its files.', {
							repository: selectedRepository.label,
						}),
			);
		});

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
			setRepositoryId('');
			setBranches([]);
			setBranch('');
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
			{error ? (
				<div className='ui-message' data-tone='error'>
					{error}
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
			<label className='ui-field-label' htmlFor='github-sync-token'>
				{t('Personal access token')}
			</label>
			<input
				id='github-sync-token'
				type='password'
				autoComplete='off'
				value={token}
				disabled={isBusy}
				placeholder='ghp_...'
				onChange={(event) => setToken(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Enter') void saveToken();
				}}
			/>
			<div className='ui-actions'>
				<button
					type='button'
					className='button primary'
					disabled={isBusy || !token.trim()}
					onClick={() => void saveToken()}
				>
					<KeyIcon />
					{busyAction === 'token' ? t('Connecting...') : t('Connect account')}
				</button>
				{hasAccountToken ? (
					<button
						type='button'
						className='button secondary'
						disabled={isBusy}
						onClick={() => setShowTokenForm(false)}
					>
						{t('Cancel')}
					</button>
				) : null}
			</div>
		</section>
	);

	const renderAccountLine = () => (
		<div className='github-sync-account ui-meta' data-layout='row'>
			<span>
				{account
					? t('Signed in to {provider} as {login}', {
							provider: provider.displayName,
							login: account.login,
						})
					: busyAction === 'account'
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
			<label className='ui-field-label' htmlFor='github-sync-repo-search'>
				{t('Repository')}
			</label>
			<input
				id='github-sync-repo-search'
				type='text'
				value={repositoryQuery}
				disabled={isBusy}
				placeholder={t('Search your repositories or paste owner/name or a URL')}
				onChange={(event) => {
					setRepositoryQuery(event.target.value);
					setRepositoryId('');
					setBranches([]);
					setBranch('');
				}}
			/>
			{repositories.length > 0 ? (
				<select
					size={Math.min(8, Math.max(3, filteredRepositories.length))}
					value={repositoryId}
					disabled={isBusy}
					onChange={(event) => {
						const selected = repositories.find(
							(item) => item.id === event.target.value,
						);
						setRepositoryQuery(selected?.label ?? event.target.value);
						void selectRepository(event.target.value);
					}}
				>
					{filteredRepositories.map((item) => (
						<option key={item.id} value={item.id}>
							{item.label}
							{item.private ? ` (${t('private')})` : ''}
						</option>
					))}
				</select>
			) : null}
			{!repositoryId && normalizedQuery.includes('/') ? (
				<button
					type='button'
					className='button secondary'
					disabled={isBusy}
					onClick={() => void selectRepository(normalizedQuery)}
				>
					{t('Use {repository}', { repository: normalizedQuery })}
				</button>
			) : null}
			{repositoryId ? (
				<>
					<label className='ui-field-label' htmlFor='github-sync-branch'>
						{t('Branch')}
					</label>
					<input
						id='github-sync-branch'
						type='text'
						list='github-sync-branches'
						value={branch}
						disabled={isBusy}
						onChange={(event) => setBranch(event.target.value)}
					/>
					<datalist id='github-sync-branches'>
						{branches.map((item) => (
							<option key={item.name} value={item.name} />
						))}
					</datalist>
					{branches.length > 0 &&
					!branches.some((item) => item.name === branch.trim()) ? (
						<p className='ui-note'>
							{t('A new remote branch will be created when you connect.')}
						</p>
					) : null}
					{renderAnnotationOption()}
					<p className='ui-note'>
						{t(
							'Linking pulls the repository into this project. If both contain files, they are merged and you can resolve any conflicts.',
						)}
					</p>
					<button
						type='button'
						className='button primary'
						disabled={isBusy || !branch.trim()}
						onClick={() => void linkExistingRepository()}
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
						onChange={() => {
							setLinkMode('existing');
							if (repositories.length === 0) void loadRepositories();
						}}
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

	const renderBody = () => {
		if (remote) return renderLinked(remote);
		if (!hasAccountToken || showTokenForm) return renderTokenForm();
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
