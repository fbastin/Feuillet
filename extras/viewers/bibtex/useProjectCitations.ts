// extras/viewers/bibtex/useProjectCitations.ts
// What the project's LaTeX files cite, for the entries of a .bib: kept up
// to date while shown, as the review overview is (src/hooks/
// useReviewOverview.ts), documents followed on the collaboration server and
// other files read from their copies; and a key renamed where it is cited.
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { t } from '@/i18n';
import { collabService } from '@/services/CollabService';
import { fileStoreService } from '@/services/FileStoreService';
import { applyBibChanges, parseBibDocument } from '@/utils/bibDocument';
import { isTemporaryFile } from '@/utils/fileUtils';
import {
	collectCitations,
	type ProjectCitations,
	renameCitationChanges,
} from '@/utils/latexCitations';
import { projectLinkKind } from '@/utils/urlUtils';

const REFRESH_DELAY_MS = 800;
// A server not reached by then: offline.
const OFFLINE_AFTER_MS = 4000;
const LATEX = /\.(tex|ltx)$/i;
const BIB = /\.bib$/i;

export interface CitationRename {
	/** The citations rewritten. */
	count: number;
	/** The files they are in. */
	files: string[];
}

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

/** The project's LaTeX and other .bib files: the one shown is not read. */
async function projectFiles(bibFileId: string | undefined) {
	return (await fileStoreService.getAllFiles(false, false, false)).filter(
		(node) =>
			node.type === 'file' &&
			node.id !== bibFileId &&
			!isTemporaryFile(node.path) &&
			(LATEX.test(node.path) || BIB.test(node.path)),
	);
}

export function useProjectCitations(
	projectId: string,
	bibFileId: string | undefined,
	enabled: boolean,
) {
	const [citations, setCitations] = useState<ProjectCitations | null>(null);
	const generation = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const scheduleRef = useRef<() => void>(() => {});
	const followed = useRef(new Map<string, FollowedDocument>());
	// The keys of each other .bib, read again only when its text changes.
	const bibKeys = useRef(new Map<string, { text: string; keys: string[] }>());
	// Documents are followed only while shown: a rename ending later does
	// not follow them again.
	const shown = useRef(enabled);
	shown.current = enabled;

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
		if (!shown.current) return;
		const current = ++generation.current;
		const nodes = await projectFiles(bibFileId);
		if (current !== generation.current) return;
		follow(
			new Set(
				nodes.flatMap((node) => (node.documentId ? [node.documentId] : [])),
			),
		);

		const latex: Array<{ path: string; text: string }> = [];
		const otherKeys: string[] = [];
		for (const node of nodes) {
			// Until a document has loaded, its copy stands in for it.
			let text = node.documentId
				? followed.current.get(node.documentId)?.text.toString()
				: undefined;
			if (!text)
				text = textOf((await fileStoreService.getFile(node.id))?.content);
			if (LATEX.test(node.path)) {
				latex.push({ path: node.path, text });
				continue;
			}
			let known = bibKeys.current.get(node.id);
			if (!known || known.text !== text) {
				known = {
					text,
					keys: parseBibDocument(text).entries.map((entry) => entry.key),
				};
				bibKeys.current.set(node.id, known);
			}
			otherKeys.push(...known.keys);
		}
		if (current !== generation.current) return;
		latex.sort((a, b) => a.path.localeCompare(b.path));
		setCitations(collectCitations(latex, otherKeys));
	}, [bibFileId, follow]);

	const schedule = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = null;
			void load();
		}, REFRESH_DELAY_MS);
	}, [load]);
	scheduleRef.current = schedule;

	// Followed while shown only: hidden, the last reading stays.
	useEffect(() => {
		if (!enabled) return;
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
	}, [enabled, load, schedule]);

	/**
	 * Writes `to` where `from` is cited in the LaTeX files, comments
	 * included: documents once caught up with the collaboration server, so
	 * that the change is on their latest text, then their copies here.
	 */
	const renameCitations = useCallback(
		async (from: string, to: string): Promise<CitationRename> => {
			if (projectLinkKind(projectId) !== 'edit') {
				throw new Error(t('This project can only be read here'));
			}
			const nodes = (await projectFiles(bibFileId))
				.filter((node) => LATEX.test(node.path))
				.sort((a, b) => a.path.localeCompare(b.path));
			const documentIds = nodes.flatMap((node) =>
				node.documentId ? [node.documentId] : [],
			);
			// Offline, each document as it is here: the change reaches the
			// others once connected again, as one typed would.
			const release = await collabService.openDocumentsUpToDate(
				projectId,
				documentIds,
				20000,
				{ offlineAfterMs: OFFLINE_AFTER_MS },
			);
			const renamed: CitationRename = { count: 0, files: [] };
			try {
				await Promise.all(
					documentIds.map((id) =>
						collabService.whenLoaded(projectId, `yjs_${id}`),
					),
				);
				for (const node of nodes) {
					const stored = textOf(
						(await fileStoreService.getFile(node.id))?.content,
					);
					let next: string | null = null;
					if (node.documentId) {
						const container = collabService.getDocContainer(
							projectId,
							`yjs_${node.documentId}`,
						);
						if (!container) continue;
						const text = container.doc.getText('codemirror');
						const changes = renameCitationChanges(text.toString(), from, to);
						if (changes.length === 0) continue;
						// Each key alone, the last first: the others' cursors
						// and changes elsewhere stay as they are.
						container.doc.transact(() => {
							for (const change of [...changes].sort(
								(a, b) => b.from - a.from,
							)) {
								text.delete(change.from, change.to - change.from);
								text.insert(change.from, change.insert);
							}
						});
						renamed.count += changes.length;
						next = text.toString();
					} else {
						const changes = renameCitationChanges(stored, from, to);
						if (changes.length === 0) continue;
						renamed.count += changes.length;
						next = applyBibChanges(stored, changes);
					}
					renamed.files.push(node.path);
					if (next !== stored) {
						await fileStoreService.updateFileContent(node.id, next);
						// A file open without a document shows its new text.
						if (!node.documentId) {
							document.dispatchEvent(
								new CustomEvent('file-reloaded', {
									detail: { filePath: node.path, fileId: node.id },
								}),
							);
						}
					}
				}
				// Sent to the server before the documents close here.
				if (renamed.count > 0) {
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
			} finally {
				release();
			}
			await load();
			return renamed;
		},
		[projectId, bibFileId, load],
	);

	return { citations, renameCitations };
}
