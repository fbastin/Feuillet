// src/components/history/GitHubSyncButton.tsx
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { GitRemoteIcon } from '@/components/common/Icons';
import { pluginRegistry } from '@/plugins/PluginRegistry';
import { gitSyncService } from '@/services/GitSyncService';
import type { GitRemoteConfig } from '@/types/gitRemote';
import GitHubSyncModal from './GitHubSyncModal';

const GITHUB_PROVIDER_ID = 'github';

interface GitHubSyncButtonProps {
	className?: string;
	projectId: string | null;
	projectName: string;
	projectDescription: string;
}

const GitHubSyncButton: React.FC<GitHubSyncButtonProps> = ({
	className = '',
	projectId,
	projectName,
	projectDescription,
}) => {
	const plugin = useMemo(
		() =>
			pluginRegistry
				.getBackup()
				.find((candidate) => candidate.gitRemote?.id === GITHUB_PROVIDER_ID) ??
			null,
		[],
	);
	const [isOpen, setIsOpen] = useState(false);
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

	if (!plugin?.gitRemote || !projectId) return null;

	const Icon = plugin.icon ?? GitRemoteIcon;
	const title = remote
		? t('Linked to {repository} ({branch})', {
				repository: remote.repositoryLabel,
				branch: remote.branch,
			})
		: t('Sync this project with {provider}', {
				provider: plugin.gitRemote.displayName,
			});

	return (
		<>
			<button
				type='button'
				className={`button github-sync-button ${className}`}
				data-linked={remote ? 'true' : 'false'}
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
					onClose={() => setIsOpen(false)}
					projectId={projectId}
					projectName={projectName}
					projectDescription={projectDescription}
					provider={plugin.gitRemote}
					icon={Icon}
				/>
			) : null}
		</>
	);
};

export default GitHubSyncButton;
