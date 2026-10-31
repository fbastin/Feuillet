// src/hooks/useImportedFiles.ts
// Files of the open project added from another project or from a URL, with
// their source, kept with the project so that every editor can refresh them,
// as Overleaf's linked files.
import { useCallback, useEffect, useMemo } from 'react';

import { t } from '@/i18n';
import { collabService } from '../services/CollabService';
import {
	FileImportError,
	fileImportService,
} from '../services/FileImportService';
import { fileStoreService } from '../services/FileStoreService';
import type { DocumentList, ImportedFileSource } from '../types/documents';
import {
	FILE_DELETED_EVENT,
	FILE_MOVED_EVENT,
	type FileDeletedDetail,
	type FileMovedDetail,
} from '../utils/fileEvents';
import {
	type ImportedFiles,
	contentChecksum,
	withMovedImportedFiles,
	withoutImportedFiles,
} from '../utils/importedFiles';
import { useAuth } from './useAuth';
import { useCollab } from './useCollab';

export type RefreshResult = 'refreshed' | 'unchanged' | 'changed-here';

const NO_FILES: ImportedFiles = {};

/**
 * @param manage The one place that keeps the sources by path: moves them
 * with their files and forgets those of deleted files.
 */
export function useImportedFiles({
	manage = false,
}: {
	manage?: boolean;
} = {}) {
	const { doc, data, readOnly } = useCollab<DocumentList>();
	const { user } = useAuth();
	const files = data?.importedFiles ?? NO_FILES;
	const canEdit = Boolean(doc) && !readOnly;

	const update = useCallback(
		(change: (current: ImportedFiles) => ImportedFiles) => {
			if (!doc || readOnly) return;
			const map = doc.getMap('data');
			doc.transact(() => {
				const stored = map.get('importedFiles') as ImportedFiles | undefined;
				const current: ImportedFiles = stored
					? JSON.parse(JSON.stringify(stored))
					: {};
				const next = change(current);
				if (JSON.stringify(next) === JSON.stringify(current)) return;
				if (Object.keys(next).length === 0) map.delete('importedFiles');
				else map.set('importedFiles', next);
			});
		},
		[doc, readOnly],
	);

	const record = useCallback(
		async (
			path: string,
			source: ImportedFileSource,
			content: ArrayBuffer | string,
		) => {
			const checksum = await contentChecksum(content);
			update((current) => ({
				...current,
				[path]: {
					source,
					checksum,
					importedAt: Date.now(),
					...(user?.username ? { importedBy: user.username } : {}),
				},
			}));
		},
		[update, user?.username],
	);

	/**
	 * Fetches the file again from its source. Unless `force`, a file changed
	 * in this project since it was imported is left alone.
	 */
	const refresh = useCallback(
		async (
			path: string,
			{ force = false }: { force?: boolean } = {},
		): Promise<RefreshResult> => {
			const entry = files[path];
			const file = await fileStoreService.getFileByPath(path);
			if (!entry || !file || file.type !== 'file') {
				throw new FileImportError(t('This file is no longer in the project.'));
			}
			const projectId = fileStoreService.getCurrentProjectId();
			const current = await currentContent(projectId, file.documentId, file);
			const currentChecksum = await contentChecksum(current);
			if (!force && currentChecksum !== entry.checksum) return 'changed-here';

			const content = await fileImportService.fetchSource(entry.source);
			const checksum = await contentChecksum(content);
			if (checksum !== currentChecksum) {
				await fileStoreService.updateFileContent(file.id, content);
				if (file.documentId) {
					const text = new TextDecoder().decode(content);
					await collabService.updateDocumentContent(
						projectId,
						file.documentId,
						() => text,
					);
				}
				document.dispatchEvent(
					new CustomEvent('file-reloaded', {
						detail: { filePath: path, fileId: file.id },
					}),
				);
			}
			update((latest) =>
				latest[path]
					? {
							...latest,
							[path]: {
								...latest[path],
								checksum,
								importedAt: Date.now(),
								...(user?.username ? { importedBy: user.username } : {}),
							},
						}
					: latest,
			);
			return checksum === currentChecksum ? 'unchanged' : 'refreshed';
		},
		[files, update, user?.username],
	);

	useEffect(() => {
		if (!manage || !doc || readOnly) return;
		const onMoved = (event: Event) => {
			const { from, to } = (event as CustomEvent<FileMovedDetail>).detail;
			update((current) => withMovedImportedFiles(current, from, to));
		};
		const onDeleted = (event: Event) => {
			const { paths } = (event as CustomEvent<FileDeletedDetail>).detail;
			update((current) => withoutImportedFiles(current, paths));
		};
		document.addEventListener(FILE_MOVED_EVENT, onMoved);
		document.addEventListener(FILE_DELETED_EVENT, onDeleted);
		return () => {
			document.removeEventListener(FILE_MOVED_EVENT, onMoved);
			document.removeEventListener(FILE_DELETED_EVENT, onDeleted);
		};
	}, [manage, doc, readOnly, update]);

	return useMemo(
		() => ({ files, canEdit, record, refresh }),
		[files, canEdit, record, refresh],
	);
}

/** A file's content now: a document's text is in the document. */
async function currentContent(
	projectId: string,
	documentId: string | undefined,
	file: { content?: ArrayBuffer | string },
): Promise<ArrayBuffer | string> {
	if (documentId) {
		const container = collabService.getDocContainer(
			projectId,
			`yjs_${documentId}`,
		);
		const text = container?.doc.getText('codemirror').toString();
		if (text) return text;
	}
	return file.content ?? '';
}
