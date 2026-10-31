// src/hooks/useReviewOverview.ts
// The comments and tracked changes of every file of the open project, kept
// up to date while shown. Documents are followed on the collaboration server,
// as their copies on this device take a collaborator's changes only once the
// document is opened here; other files are read from their copies.
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { collabService } from '../services/CollabService';
import { fileStoreService } from '../services/FileStoreService';
import { isBinaryFile, isTemporaryFile } from '../utils/fileUtils';
import {
	type ReviewOverviewFile,
	reviewItemsOf,
} from '../utils/reviewOverview';

const REFRESH_DELAY_MS = 800;

interface FollowedDocument {
	text: Y.Text;
	release: () => void;
}

const textOf = (content: string | ArrayBuffer | undefined): string =>
	typeof content === 'string'
		? content
		: content
			? new TextDecoder().decode(content)
			: '';

export function useReviewOverview(projectId: string) {
	const [files, setFiles] = useState<ReviewOverviewFile[] | null>(null);
	const generation = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const scheduleRef = useRef<() => void>(() => {});
	const followed = useRef(new Map<string, FollowedDocument>());

	// Keeps the given documents connected, and only those, each refreshing
	// the overview when its text changes or catches up with the server.
	const follow = useCallback(
		(documentIds: Set<string>) => {
			for (const [id, entry] of followed.current) {
				if (documentIds.has(id)) continue;
				entry.release();
				followed.current.delete(id);
			}
			for (const id of documentIds) {
				if (followed.current.has(id)) continue;
				const collection = `yjs_${id}`;
				const { doc, provider } = collabService.connect(projectId, collection);
				const text = doc.getText('codemirror');
				const onChange = () => scheduleRef.current();
				text.observe(onChange);
				provider?.on('sync', onChange);
				followed.current.set(id, {
					text,
					release: () => {
						text.unobserve(onChange);
						provider?.off?.('sync', onChange);
						collabService.disconnect(projectId, collection);
					},
				});
			}
		},
		[projectId],
	);

	const load = useCallback(async () => {
		const current = ++generation.current;
		const nodes = (
			await fileStoreService.getAllFiles(false, false, false)
		).filter(
			(node) =>
				node.type === 'file' &&
				!isTemporaryFile(node.path) &&
				!isBinaryFile(node.path),
		);
		if (current !== generation.current) return;
		follow(
			new Set(
				nodes.flatMap((node) => (node.documentId ? [node.documentId] : [])),
			),
		);

		const found: ReviewOverviewFile[] = [];
		for (const node of nodes) {
			// Until a document has loaded, its copy stands in for it.
			let text = node.documentId
				? followed.current.get(node.documentId)?.text.toString()
				: undefined;
			if (!text)
				text = textOf((await fileStoreService.getFile(node.id))?.content);
			const items = reviewItemsOf(text);
			if (items.length > 0) {
				found.push({
					path: node.path,
					fileId: node.id,
					documentId: node.documentId,
					items,
				});
			}
		}
		if (current !== generation.current) return;

		found.sort((a, b) => a.path.localeCompare(b.path));
		setFiles(found);
	}, [follow]);

	const schedule = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = null;
			void load();
		}, REFRESH_DELAY_MS);
	}, [load]);
	scheduleRef.current = schedule;

	useEffect(() => {
		void load();
		document.addEventListener('file-content-changed', schedule);
		document.addEventListener('refresh-file-tree', schedule);
		const documents = followed.current;
		return () => {
			document.removeEventListener('file-content-changed', schedule);
			document.removeEventListener('refresh-file-tree', schedule);
			if (timer.current) clearTimeout(timer.current);
			generation.current++;
			for (const entry of documents.values()) entry.release();
			documents.clear();
		};
	}, [load, schedule]);

	/**
	 * Changes a file's text as a decision taken from the overview: a
	 * document once it has caught up with the collaboration server, so that
	 * the decision is on its latest text, then its copy on this device.
	 */
	const apply = useCallback(
		async (file: ReviewOverviewFile, transform: (text: string) => string) => {
			let decided: string | undefined;
			if (file.documentId) {
				const release = await collabService.openDocumentsUpToDate(projectId, [
					file.documentId,
				]);
				try {
					await collabService.updateDocumentContent(
						projectId,
						file.documentId,
						(current) => {
							decided = transform(current);
							return decided;
						},
					);
				} finally {
					release();
				}
			}
			const node = await fileStoreService.getFile(file.fileId);
			if (node) {
				const stored = textOf(node.content);
				const next = decided ?? transform(stored);
				if (next !== stored) {
					await fileStoreService.updateFileContent(node.id, next);
					// A file open without a document shows its new text.
					if (!file.documentId) {
						document.dispatchEvent(
							new CustomEvent('file-reloaded', {
								detail: { filePath: node.path, fileId: node.id },
							}),
						);
					}
				}
			}
			await load();
		},
		[projectId, load],
	);

	return { files, refresh: load, apply };
}
