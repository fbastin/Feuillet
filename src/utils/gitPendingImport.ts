// src/utils/gitPendingImport.ts
import type { GitRemoteRepository } from '../types/gitRemote';

// A project created by "Import from GitHub" on the dashboard is linked and
// pulled once the editor has opened it.
export interface PendingGitImport {
	providerId: string;
	repository: GitRemoteRepository;
	branch: string;
	cleanAnnotations: boolean;
}

const STORAGE_PREFIX = 'texlyre-pending-git-import:';

export function setPendingGitImport(
	projectId: string,
	pending: PendingGitImport,
): void {
	sessionStorage.setItem(
		`${STORAGE_PREFIX}${projectId}`,
		JSON.stringify(pending),
	);
}

export function takePendingGitImport(
	projectId: string,
): PendingGitImport | null {
	const key = `${STORAGE_PREFIX}${projectId}`;
	const stored = sessionStorage.getItem(key);
	if (!stored) return null;
	sessionStorage.removeItem(key);
	try {
		return JSON.parse(stored) as PendingGitImport;
	} catch {
		return null;
	}
}
