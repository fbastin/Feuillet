// src/components/history/GitHubSyncButton.tsx
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';
import { GitRemoteIcon } from '@/components/common/Icons';
import { useCollab } from '@/hooks/useCollab';
import { useSecrets } from '@/hooks/useSecrets';
import { pluginRegistry } from '@/plugins/PluginRegistry';
import { collabService } from '@/services/CollabService';
import { gitSyncService } from '@/services/GitSyncService';
import type { DocumentList, SharedGitRemote } from '@/types/documents';
import type { GitRemoteConfig } from '@/types/gitRemote';
import {
	type PendingGitImport,
	takePendingGitImport,
} from '@/utils/gitPendingImport';
import GitHubSyncModal from './GitHubSyncModal';

const GITHUB_PROVIDER_ID = 'github';
const STATUS_INTERVAL_MS = 3 * 60_000;

const sharedLinkOf = (config: GitRemoteConfig): SharedGitRemote => ({
	providerId: config.providerId,
	repositoryId: config.repositoryId,
	repositoryLabel: config.repositoryLabel,
	branch: config.branch,
	...(config.syncBase ? { syncedCommit: config.syncBase.remoteOid } : {}),
});

const sameRepository = (a?: SharedGitRemote, b?: SharedGitRemote) =>
	a?.providerId === b?.providerId &&
	a?.repositoryId === b?.repositoryId &&
	a?.branch === b?.branch;

const sameLink = (a?: SharedGitRemote, b?: SharedGitRemote) =>
	sameRepository(a, b) && a?.syncedCommit === b?.syncedCommit;

// The same repository, on whichever branch.
const sameRepositoryAnyBranch = (a?: SharedGitRemote, b?: SharedGitRemote) =>
	a?.providerId === b?.providerId && a?.repositoryId === b?.repositoryId;

export const findGitHubPlugin = () =>
	pluginRegistry
		.getBackup()
		.find((candidate) => candidate.gitRemote?.id === GITHUB_PROVIDER_ID) ??
	null;

interface GitHubSyncButtonProps {
	className?: string;
	projectId: string | null;
	projectName: string;
	projectDescription: string;
	// Whether the project's own Git address (GitCloneButton) is offered.
	offersGit?: boolean;
}

const GitHubSyncButton: React.FC<GitHubSyncButtonProps> = ({
	className = '',
	projectId,
	projectName,
	projectDescription,
	offersGit = false,
}) => {
	const plugin = useMemo(findGitHubPlugin, []);
	const [isOpen, setIsOpen] = useState(false);
	const [pendingImport, setPendingImport] = useState<PendingGitImport | null>(
		null,
	);
	const [remote, setRemote] = useState<GitRemoteConfig | undefined>(() =>
		projectId ? gitSyncService.getConfig(projectId) : undefined,
	);

	useEffect(() => {
		if (!projectId) {
			setRemote(undefined);
			return;
		}
		setRemote(gitSyncService.getConfig(projectId));
		return gitSyncService.addListener(projectId, setRemote);
	}, [projectId]);

	useEffect(() => {
		if (!projectId || !plugin?.gitRemote) return;
		const pending = takePendingGitImport(projectId);
		if (pending?.providerId !== plugin.gitRemote.id) return;
		setPendingImport(pending);
		setIsOpen(true);
	}, [plugin, projectId]);

	// The repository is the project's, as on Overleaf: linking or unlinking
	// it here shows on the collaborators' devices too.
	const { data } = useCollab<DocumentList>();
	const loaded = data !== undefined && data !== null;
	const shared =
		data?.gitRemote?.providerId === plugin?.gitRemote?.id
			? data?.gitRemote
			: undefined;
	const sharedRef = useRef(shared);
	sharedRef.current = shared;
	const previousRemote = useRef(remote);
	useEffect(() => {
		const before = previousRemote.current;
		previousRemote.current = remote;
		if (!projectId || !loaded) return;
		const map = collabService
			.getDocContainer(projectId, 'yjs_metadata')
			?.doc.getMap('data');
		if (!map) return;
		if (remote) {
			const link = sharedLinkOf(remote);
			const current = sharedRef.current;
			// Another branch of the same repository: a collaborator switched
			// it, and this device follows (below); a switch made here tells
			// it itself (GitProjectSyncService).
			if (
				current &&
				sameRepositoryAnyBranch(current, link) &&
				current.branch !== link.branch
			)
				return;
			// Without a synced commit of its own (it just followed the branch),
			// this device leaves the one the project has.
			if (sameRepository(current, link) && !link.syncedCommit) return;
			if (!sameLink(current, link)) map.set('gitRemote', link);
		} else if (
			before &&
			sameRepository(sharedRef.current, sharedLinkOf(before))
		) {
			map.delete('gitRemote');
		}
	}, [remote, projectId, loaded]);

	// The project's branch, as its collaborators chose it: this device
	// pushes and pulls there too.
	// On the branch's name only: while a switch made here is under way, the
	// project's metadata changes (its files) before it tells the new branch.
	const sharedProvider = shared?.providerId;
	const sharedRepository = shared?.repositoryId;
	const sharedBranch = shared?.branch;
	useEffect(() => {
		if (!projectId || !sharedBranch) return;
		const config = gitSyncService.getConfig(projectId);
		if (
			config &&
			config.providerId === sharedProvider &&
			config.repositoryId === sharedRepository &&
			config.branch !== sharedBranch
		) {
			gitSyncService.linkBranch(projectId, sharedBranch);
		}
	}, [projectId, sharedProvider, sharedRepository, sharedBranch]);

	// Whether the repository has commits this project has not pulled yet,
	// checked now and then without asking for the password.
	const { getSecret } = useSecrets();
	const [remoteChanged, setRemoteChanged] = useState(false);
	// The linked branch was deleted on GitHub: the window says what to do.
	const [branchGone, setBranchGone] = useState(false);
	const checkStatus = useCallback(async () => {
		if (!projectId || !gitSyncService.getConfig(projectId)) {
			setRemoteChanged(false);
			setBranchGone(false);
			return;
		}
		try {
			const status = await gitSyncService.getSyncStatus(projectId, {
				getSecret: (pluginId, secretKey, options) =>
					getSecret(pluginId, secretKey, { ...options, prompt: false }),
			});
			setRemoteChanged(status.remoteChanged);
			setBranchGone(status.branchGone);
		} catch {
			// No token at hand yet, or offline: nothing to show.
		}
	}, [projectId, getSecret]);
	useEffect(() => {
		if (!remote || isOpen) return;
		void checkStatus();
		const timer = window.setInterval(
			() => void checkStatus(),
			STATUS_INTERVAL_MS,
		);
		const onFocus = () => void checkStatus();
		window.addEventListener('focus', onFocus);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener('focus', onFocus);
		};
	}, [remote, isOpen, checkStatus]);

	if (!plugin?.gitRemote || !projectId) return null;

	const Icon = plugin.icon ?? GitRemoteIcon;
	const linked = remote ?? shared;
	const provider = plugin.gitRemote.displayName;
	const title = branchGone
		? t('The branch {branch} no longer exists on {provider}.', {
				branch: remote?.branch ?? '',
				provider,
			})
		: remoteChanged
			? t('{provider} has changes that are not in this project yet.', {
					provider,
				})
			: linked
				? t('Linked to {repository} ({branch})', {
						repository: linked.repositoryLabel,
						branch: linked.branch,
					})
				: t('Sync this project with {provider}', { provider });

	return (
		<>
			<button
				type='button'
				className={`button github-sync-button ${className}`}
				data-linked={remote ? 'true' : shared ? 'shared' : 'false'}
				data-remote-changes={remoteChanged || branchGone || undefined}
				data-branch-gone={branchGone || undefined}
				title={title}
				onClick={() => setIsOpen(true)}
			>
				<Icon />
				<span className='github-sync-button-label'>
					{plugin.gitRemote.displayName}
				</span>
			</button>
			{isOpen ? (
				<GitHubSyncModal
					isOpen={isOpen}
					onClose={() => {
						setIsOpen(false);
						setPendingImport(null);
					}}
					projectId={projectId}
					projectName={projectName}
					projectDescription={projectDescription}
					provider={plugin.gitRemote}
					icon={Icon}
					pendingImport={pendingImport}
					sharedRemote={remote ? undefined : shared}
					offersGit={offersGit}
				/>
			) : null}
		</>
	);
};

export default GitHubSyncButton;
