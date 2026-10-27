// src/services/ServerFileSyncService.ts
import { nanoid } from 'nanoid';
import type * as Y from 'yjs';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import type { User } from '../types/auth';
import type { FileNode } from '../types/files';
import { getMimeType, isBinaryFile } from '../utils/fileUtils';
import {
	type FileManifestEntry,
	manifestEntryFor,
	planServerFileSync,
} from '../utils/serverFileSyncUtils';
import { isReadOnlyProjectId } from '../utils/urlUtils';
import { fileStoreService } from './FileStoreService';
import { peerFileSyncService } from './PeerFileSyncService';

const moduleLog = createNamedLogger('ServerFileSyncService');

export const FILE_MANIFEST_KEY = 'files';
export const LOCAL_MANIFEST_ORIGIN = 'server-file-sync-local';

export interface ServerFileSyncResult {
	published: number;
	applied: number;
	failures: string[];
}

interface SynchronizeOptions {
	doc: Y.Doc;
	projectId: string;
	docUrl: string;
	baseUrl: string;
	user: User;
}

const errorText = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/**
 * Keeps the project files of every collaborator identical through the
 * collaboration server: a shared Yjs manifest lists the files, and their
 * contents are stored on the server by SHA-256.
 */
class ServerFileSyncService {
	private fileUrl(baseUrl: string, projectId: string, checksum: string) {
		return `${baseUrl}/files/${encodeURIComponent(projectId)}/${checksum}`;
	}

	private async readLocalContent(fileId: string): Promise<ArrayBuffer> {
		const file = await fileStoreService.getFile(fileId);
		if (!file?.content) return new ArrayBuffer(0);
		return file.content instanceof ArrayBuffer
			? file.content
			: new TextEncoder().encode(file.content).buffer;
	}

	async uploadContent(
		baseUrl: string,
		projectId: string,
		checksum: string,
		content: ArrayBuffer,
	): Promise<void> {
		const url = this.fileUrl(baseUrl, projectId, checksum);
		const existing = await fetch(url, { method: 'HEAD' });
		if (existing.ok) return;

		const response = await fetch(url, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: content,
		});
		if (response.status === 413) {
			throw new Error(t('The file is too large for the collaboration server.'));
		}
		if (!response.ok) {
			throw new Error(
				t('The collaboration server refused the file ({status}).', {
					status: response.status,
				}),
			);
		}
	}

	async downloadContent(
		baseUrl: string,
		projectId: string,
		checksum: string,
	): Promise<ArrayBuffer> {
		const response = await fetch(this.fileUrl(baseUrl, projectId, checksum));
		if (!response.ok) {
			throw new Error(
				t('The collaboration server has no copy of this file ({status}).', {
					status: response.status,
				}),
			);
		}
		const content = await response.arrayBuffer();
		if (
			(await peerFileSyncService.calculateFileChecksum(content)) !== checksum
		) {
			throw new Error(t('The downloaded file is corrupted.'));
		}
		return content;
	}

	async synchronize({
		doc,
		projectId,
		docUrl,
		baseUrl,
		user,
	}: SynchronizeOptions): Promise<ServerFileSyncResult> {
		const manifest = doc.getMap<FileManifestEntry>(FILE_MANIFEST_KEY);
		const localFiles = await peerFileSyncService.getLocalFileSyncInfo(
			user.id,
			user.username,
			docUrl,
		);
		const plan = planServerFileSync(localFiles, new Map(manifest.entries()));
		const failures: string[] = [];

		// Through a read-only link, files only come in.
		const toPublish = isReadOnlyProjectId(projectId) ? [] : plan.publish;
		const published: FileManifestEntry[] = [];
		for (const file of toPublish) {
			try {
				if (!file.deleted) {
					await this.uploadContent(
						baseUrl,
						projectId,
						file.checksum,
						await this.readLocalContent(file.fileId),
					);
				}
				published.push(manifestEntryFor(file, user.username));
			} catch (error) {
				moduleLog.warn(`Failed to publish ${file.filePath}:`, error);
				failures.push(
					t('Could not share {path}: {message}', {
						path: file.filePath,
						message: errorText(error),
					}),
				);
			}
		}

		if (published.length > 0) {
			doc.transact(() => {
				for (const entry of published) {
					const current = manifest.get(entry.path);
					if (!current || current.lastModified <= entry.lastModified) {
						manifest.set(entry.path, entry);
					}
				}
			}, LOCAL_MANIFEST_ORIGIN);
		}

		// Files linked to documents come first: the editor waits for the file
		// of the open document, while images can take long to download.
		const isLinked = (entry: FileManifestEntry) =>
			Boolean(entry.documentId) && !entry.deleted;
		let applied = 0;
		for (const entries of [
			plan.apply.filter(isLinked),
			plan.apply.filter((entry) => !isLinked(entry)),
		]) {
			applied += await this.applyEntries(
				entries,
				projectId,
				docUrl,
				baseUrl,
				failures,
			);
		}
		return { published: published.length, applied, failures };
	}

	private async applyEntries(
		entries: FileManifestEntry[],
		projectId: string,
		docUrl: string,
		baseUrl: string,
		failures: string[],
	): Promise<number> {
		const filesToStore: FileNode[] = [];
		let deleted = 0;

		for (const entry of entries) {
			try {
				if (entry.deleted) {
					await fileStoreService.initialize(docUrl);
					await fileStoreService.deleteFileByPath(entry.path, {
						showDeleteDialog: false,
						hardDelete: false,
						allowLinkedFileDelete: true,
					});
					deleted += 1;
					continue;
				}

				const content = await this.downloadContent(
					baseUrl,
					projectId,
					entry.checksum,
				);
				await fileStoreService.initialize(docUrl);
				await fileStoreService.createDirectoryPath(entry.path);
				const existing = await fileStoreService.getFileByPath(entry.path, true);
				const name = entry.path.split('/').pop() || entry.path;
				filesToStore.push({
					id: existing?.id ?? nanoid(),
					name,
					path: entry.path,
					type: 'file',
					content,
					lastModified: entry.lastModified,
					size: content.byteLength,
					mimeType: getMimeType(name),
					isBinary: isBinaryFile(name),
					isDeleted: false,
					documentId: entry.documentId,
				});
			} catch (error) {
				moduleLog.warn(`Failed to receive ${entry.path}:`, error);
				failures.push(
					t('Could not receive {path}: {message}', {
						path: entry.path,
						message: errorText(error),
					}),
				);
			}
		}

		if (filesToStore.length > 0) {
			await fileStoreService.initialize(docUrl);
			await fileStoreService.batchStoreFiles(filesToStore, {
				preserveTimestamp: true,
				showConflictDialog: false,
				preserveDeletionStatus: false,
			});
		}
		return filesToStore.length + deleted;
	}
}

export const serverFileSyncService = new ServerFileSyncService();
