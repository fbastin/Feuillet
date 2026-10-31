// src/utils/editorTabUtils.ts
import type { EditorTab } from '../types/editorTabs';
import { type FileMovedDetail, movedPath, nameOf } from './fileEvents';

/**
 * Tabs once files moved: their path, their file's new id, and their title,
 * which is the file's name, or the document's name, its path when linked.
 */
export function withMovedTabs(
	tabs: EditorTab[],
	{ from, to, ids = {} }: FileMovedDetail,
): EditorTab[] {
	let changed = false;
	const next = tabs.map((tab) => {
		const path = movedPath(tab.filePath, from, to);
		if (!path || !tab.filePath) return tab;
		changed = true;
		const title =
			tab.type === 'file'
				? nameOf(path)
				: tab.title === tab.filePath
					? path
					: tab.title;
		const fileId = tab.fileId ? (ids[tab.fileId] ?? tab.fileId) : undefined;
		return {
			...tab,
			filePath: path,
			title,
			...(fileId ? { fileId } : {}),
		};
	});
	return changed ? next : tabs;
}
