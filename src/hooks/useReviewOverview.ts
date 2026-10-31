// src/hooks/useReviewOverview.ts
// The comments and tracked changes of every file of the open project, kept
// up to date while shown: open documents as they are typed, the other files
// as their copies on this device change.
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

export function useReviewOverview(projectId: string) {
	const [files, setFiles] = useState<ReviewOverviewFile[] | null>(null);
	const generation = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const unobserve = useRef<() => void>(() => {});
	const scheduleRef = useRef<() => void>(() => {});

	const load = useCallback(async () => {
		const current = ++generation.current;
		const nodes = await fileStoreService.getAllFiles(false, false, false);
		const found: ReviewOverviewFile[] = [];
		const texts: Y.Text[] = [];

		for (const node of nodes) {
			if (
				node.type !== 'file' ||
				isTemporaryFile(node.path) ||
				isBinaryFile(node.path)
			) {
				continue;
			}
			// An open document's text is newer than its file.
			const live = node.documentId
				? collabService
						.getDocContainer(projectId, `yjs_${node.documentId}`)
						?.doc.getText('codemirror')
				: undefined;
			let text = live?.toString();
			if (live) texts.push(live);
			if (text === undefined) {
				const stored = (await fileStoreService.getFile(node.id))?.content;
				text =
					typeof stored === 'string'
						? stored
						: stored
							? new TextDecoder().decode(stored)
							: '';
			}
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

		unobserve.current();
		const onChange = () => scheduleRef.current();
		for (const text of texts) text.observe(onChange);
		unobserve.current = () => {
			for (const text of texts) text.unobserve(onChange);
		};
	}, [projectId]);

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
		return () => {
			document.removeEventListener('file-content-changed', schedule);
			document.removeEventListener('refresh-file-tree', schedule);
			if (timer.current) clearTimeout(timer.current);
			unobserve.current();
			generation.current++;
		};
	}, [load, schedule]);

	return { files, refresh: load };
}
