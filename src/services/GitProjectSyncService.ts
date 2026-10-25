// src/services/GitProjectSyncService.ts
import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import type { SecretsContextType } from '../contexts/SecretsContext';
import type { User } from '../types/auth';
import { stripAnnotationTagsWithSpans } from '../utils/annotationTagUtils';
import { type GitMergePlan, gitService } from './GitService';
import { type GitPushSummary, gitSyncService } from './GitSyncService';
import {
	type ConflictResolution,
	type FileConflict,
	mergeResolutionService,
} from './MergeResolutionService';

const moduleLog = createNamedLogger('GitProjectSyncService');

type GitSyncSecrets = Pick<SecretsContextType, 'getSecret'>;

export type GitProjectPullResult =
	| { status: 'empty-remote' }
	| {
			status:
				| 'cancelled'
				| 'adopted'
				| 'up-to-date'
				| 'fast-forward'
				| 'merged';
			remoteLabel: string;
	  };

export interface GitProjectPushResult {
	committedOid: string | null;
	pull: GitProjectPullResult | null;
	push: GitPushSummary | null;
}

export interface GitProjectSyncOptions {
	secrets: GitSyncSecrets;
	user: User | null;
	commitMessage: string;
}

const notifyHistoryChanged = () =>
	document.dispatchEvent(new CustomEvent('git-history-changed'));

const resolutionText = (
	plan: GitMergePlan,
	resolutions: Map<string, ConflictResolution>,
): Map<string, string> => {
	const text = new Map<string, string>();
	for (const conflict of plan.conflicts) {
		const resolution = resolutions.get(conflict.path);
		if (!resolution) continue;
		const content =
			resolution.action === 'keep-local'
				? conflict.localContent
				: resolution.action === 'keep-remote'
					? conflict.remoteContent
					: resolution.content;
		if (typeof content !== 'string') {
			throw new Error(
				'Binary merge conflicts cannot be resolved in the text merge editor',
			);
		}
		text.set(conflict.path, content);
	}
	return text;
};

class GitProjectSyncService {
	async resolveMergeConflicts(
		plan: GitMergePlan,
		remoteLabel = plan.theirsBranch,
	): Promise<Map<string, string> | null> {
		const unsupported = plan.conflicts.find(
			(conflict) =>
				conflict.isBinary || !conflict.localExists || !conflict.remoteExists,
		);
		if (unsupported) {
			throw new Error(
				t(
					'Merge conflict in {path} involves a binary file or deletion and cannot be resolved safely in the text editor.',
					{
						path: unsupported.path,
					},
				),
			);
		}

		const conflicts: FileConflict[] = plan.conflicts.map((conflict) => {
			const local = stripAnnotationTagsWithSpans(
				conflict.localContent as string,
			);
			const remote = stripAnnotationTagsWithSpans(
				conflict.remoteContent as string,
			);
			return {
				path: conflict.path,
				isBinary: false,
				baseContent: conflict.baseContent as string,
				localContent: conflict.localContent,
				remoteContent: conflict.remoteContent,
				localViewContent: local.content,
				remoteViewContent: remote.content,
				localAnnotationSpans: local.spans,
				annotationSpans: remote.spans,
			};
		});

		const resolutions = await mergeResolutionService.resolveConflicts(
			conflicts,
			{
				keepLocal: t('Keep {branch}', { branch: plan.oursBranch }),
				keepRemote: t('Keep {branch}', { branch: remoteLabel }),
			},
		);
		if (!resolutions) return null;
		return resolutionText(plan, resolutions);
	}

	async commitPendingChanges(
		projectId: string,
		message: string,
		user: User | null,
	): Promise<string | null> {
		if (!(await gitService.isInitialized(projectId))) {
			await gitService.initialize(projectId);
		}
		if ((await gitService.getChanges(projectId)).length === 0) return null;
		return gitService.commit(projectId, message, user);
	}

	/**
	 * Fetches the linked remote branch and merges it into the current branch.
	 * The working tree must be clean; use `pullWithLocalChanges` to commit
	 * pending edits first.
	 */
	async pull(
		projectId: string,
		secrets: GitSyncSecrets,
		user: User | null,
	): Promise<GitProjectPullResult> {
		let temporaryBranch: string | null = null;
		try {
			const fetched = await gitSyncService.fetchForMerge(projectId, secrets);
			if (!fetched) return { status: 'empty-remote' };
			temporaryBranch = fetched.temporaryBranch;
			const remoteLabel = `${fetched.repositoryLabel} · ${fetched.remoteBranch}`;

			let status: 'adopted' | 'up-to-date' | 'fast-forward' | 'merged';
			if (!(await gitService.getHeadOid(projectId))) {
				await gitSyncService.adoptFetched(projectId, fetched);
				status = 'adopted';
			} else {
				let result = await gitService.mergeBranch(
					projectId,
					fetched.temporaryBranch,
					user,
					{ allowUnrelatedHistories: true },
				);
				if (result.status === 'conflicts') {
					const resolved = await this.resolveMergeConflicts(
						result.plan,
						remoteLabel,
					);
					if (!resolved) return { status: 'cancelled', remoteLabel };
					result = await gitService.completeBranchMerge(
						projectId,
						result.plan,
						resolved,
						user,
					);
				}
				if (result.status !== 'merged') {
					throw new Error(t('Failed to pull remote'));
				}
				status = result.alreadyMerged
					? 'up-to-date'
					: result.fastForward
						? 'fast-forward'
						: 'merged';
			}
			await gitService.resetAll(projectId);
			gitSyncService.markFetchedSynced(projectId, fetched);
			notifyHistoryChanged();
			return { status, remoteLabel };
		} finally {
			if (temporaryBranch) {
				await gitSyncService
					.discardFetched(projectId, temporaryBranch)
					.catch((cleanupError) => {
						moduleLog.warn(
							'Failed to remove temporary remote branch:',
							cleanupError,
						);
					});
			}
		}
	}

	/**
	 * Overleaf-style pull: pending edits are committed first so they are merged
	 * with the remote changes instead of blocking the pull.
	 */
	async pullWithLocalChanges(
		projectId: string,
		{ secrets, user, commitMessage }: GitProjectSyncOptions,
	): Promise<GitProjectPullResult & { committedOid: string | null }> {
		const committedOid = await this.commitPendingChanges(
			projectId,
			commitMessage,
			user,
		);
		return { ...(await this.pull(projectId, secrets, user)), committedOid };
	}

	/**
	 * Overleaf-style push: pending edits are committed with the given message,
	 * remote changes are merged in when the remote branch moved, and the result
	 * is pushed.
	 */
	async push(
		projectId: string,
		{ secrets, user, commitMessage }: GitProjectSyncOptions,
	): Promise<GitProjectPushResult> {
		const committedOid = await this.commitPendingChanges(
			projectId,
			commitMessage,
			user,
		);

		let pull: GitProjectPullResult | null = null;
		if (
			(await gitSyncService.getSyncStatus(projectId, secrets)).remoteChanged
		) {
			pull = await this.pull(projectId, secrets, user);
			if (pull.status === 'cancelled') {
				return { committedOid, pull, push: null };
			}
		}

		if (!(await gitService.getHeadOid(projectId))) {
			throw new Error(t('The project has no files to push yet.'));
		}
		const push = await gitSyncService.push(projectId, secrets);
		notifyHistoryChanged();
		return { committedOid, pull, push };
	}
}

export const gitProjectSyncService = new GitProjectSyncService();
