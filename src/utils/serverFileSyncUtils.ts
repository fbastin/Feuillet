// src/utils/serverFileSyncUtils.ts
import type { FileSyncInfo } from '../types/fileSync';

/**
 * One file of the project as published to the shared manifest. Contents live
 * on the collaboration server, addressed by their SHA-256 checksum.
 */
export interface FileManifestEntry {
	path: string;
	checksum: string;
	size: number;
	lastModified: number;
	documentId?: string;
	deleted: boolean;
	updatedBy: string;
}

export interface ServerFileSyncPlan {
	/** Local files newer than the manifest: upload and publish. */
	publish: FileSyncInfo[];
	/** Manifest entries newer than the local copy: download or delete. */
	apply: FileManifestEntry[];
}

const sameState = (local: FileSyncInfo, entry: FileManifestEntry): boolean =>
	Boolean(local.deleted) === entry.deleted &&
	(entry.deleted ||
		(local.checksum === entry.checksum &&
			(local.documentId ?? '') === (entry.documentId ?? '')));

/**
 * Last writer wins per path. Files linked to the same collaborative document
 * get their text through Yjs, so a remote snapshot never overwrites them;
 * newer local snapshots are still published for collaborators who do not
 * have the file yet.
 */
export function planServerFileSync(
	localFiles: FileSyncInfo[],
	manifest: Map<string, FileManifestEntry>,
): ServerFileSyncPlan {
	const plan: ServerFileSyncPlan = { publish: [], apply: [] };
	const localByPath = new Map(localFiles.map((file) => [file.filePath, file]));

	for (const local of localFiles) {
		const entry = manifest.get(local.filePath);
		if (!entry) {
			if (!local.deleted) plan.publish.push(local);
			continue;
		}
		if (sameState(local, entry)) continue;

		const sharedDocument =
			!local.deleted &&
			!entry.deleted &&
			Boolean(local.documentId) &&
			local.documentId === entry.documentId;
		if (local.lastModified > entry.lastModified) {
			plan.publish.push(local);
		} else if (!sharedDocument) {
			plan.apply.push(entry);
		}
	}

	for (const entry of manifest.values()) {
		if (!entry.deleted && !localByPath.has(entry.path)) {
			plan.apply.push(entry);
		}
	}

	return plan;
}

export function manifestEntryFor(
	local: FileSyncInfo,
	username: string,
): FileManifestEntry {
	return {
		path: local.filePath,
		checksum: local.deleted ? '' : local.checksum,
		size: local.deleted ? 0 : local.size,
		lastModified: local.lastModified,
		...(local.documentId ? { documentId: local.documentId } : {}),
		deleted: Boolean(local.deleted),
		updatedBy: username,
	};
}

/** `wss://host/collab` → `https://host/collab` (the server's HTTP side). */
export function collabHttpBaseUrl(websocketServer: string): string {
	return websocketServer
		.trim()
		.replace(/^ws(s?):\/\//i, 'http$1://')
		.replace(/\/+$/, '');
}
