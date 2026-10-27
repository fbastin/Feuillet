// src/components/history/ProjectVersionsPanel.tsx
import { nanoid } from 'nanoid';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { useCollab } from '../../hooks/useCollab';
import { useSettings } from '../../hooks/useSettings';
import { collabService } from '../../services/CollabService';
import { fileStoreService } from '../../services/FileStoreService';
import { peerFileSyncService } from '../../services/PeerFileSyncService';
import {
	type ProjectVersion,
	type VersionChange,
	type VersionEntry,
	type VersionSummary,
	projectHistoryService,
} from '../../services/ProjectHistoryService';
import type { DocumentList } from '../../types/documents';
import { getMimeType, isBinaryFile } from '../../utils/fileUtils';
import { collabHttpBaseUrl } from '../../utils/serverFileSyncUtils';
import { RefreshIcon, UndoIcon } from '../common/Icons';
import type { GitDiffView } from './GitDiffViewer';

const REFRESH_MS = 30_000;

interface ProjectVersionsPanelProps {
	projectId: string;
	onOpenDiff: (view: GitDiffView) => void;
	onClearDiff: () => void;
}

const statusLabel = (type: VersionChange['type']): string =>
	type === 'added' ? 'A' : type === 'deleted' ? 'D' : 'M';

const dayOf = (time: number) =>
	new Date(time).toLocaleDateString(undefined, {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});

const timeOf = (time: number) =>
	new Date(time).toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
	});

// Versions saved a few seconds apart differ by their seconds.
const momentOf = (time: number) =>
	new Date(time).toLocaleString(undefined, {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});

const entryAt = (version: ProjectVersion | null, path: string) =>
	version
		? ([...version.docs, ...version.files].find(
				(entry) => entry.path === path,
			) ?? null)
		: null;

/**
 * The versions the collaboration server saved of the project, as on
 * Overleaf: who changed what and when, each change shown against the version
 * before it, and any file or the whole project restored as it was.
 */
const ProjectVersionsPanel: React.FC<ProjectVersionsPanelProps> = ({
	projectId,
	onOpenDiff,
	onClearDiff,
}) => {
	const { data, readOnly } = useCollab<DocumentList>();
	const { getSetting } = useSettings();
	const onServer = getSetting('collab-provider-type')?.value === 'websocket';
	const websocketServer =
		(getSetting('collab-websocket-server')?.value as string | undefined) ?? '';
	const baseUrl = onServer ? collabHttpBaseUrl(websocketServer) : '';
	const [versions, setVersions] = useState<VersionSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		if (!baseUrl) return;
		try {
			setVersions(await projectHistoryService.listVersions(baseUrl, projectId));
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [baseUrl, projectId]);

	useEffect(() => {
		void refresh();
		const timer = setInterval(() => void refresh(), REFRESH_MS);
		return () => clearInterval(timer);
	}, [refresh]);

	useEffect(() => () => onClearDiff(), [onClearDiff]);

	const days = useMemo(() => {
		const groups: Array<{ day: string; versions: VersionSummary[] }> = [];
		for (const version of versions ?? []) {
			const day = dayOf(version.time);
			const last = groups[groups.length - 1];
			if (last?.day === day) last.versions.push(version);
			else groups.push({ day, versions: [version] });
		}
		return groups;
	}, [versions]);

	// A version and the one before it, which its changes are shown against.
	const load = async (version: VersionSummary) => {
		const index = versions?.findIndex((entry) => entry.id === version.id) ?? -1;
		const older = index >= 0 ? versions?.[index + 1] : undefined;
		const [current, previous] = await Promise.all([
			projectHistoryService.getVersion(baseUrl, projectId, version.id),
			older
				? projectHistoryService.getVersion(baseUrl, projectId, older.id)
				: Promise.resolve(null),
		]);
		return { current, previous };
	};

	const contentOf = async (entry: VersionEntry | null, binary: boolean) => {
		if (!entry) return binary ? new ArrayBuffer(0) : '';
		if (binary) return new ArrayBuffer(0);
		return projectHistoryService.getText(baseUrl, projectId, entry.hash);
	};

	const openDiff = async (version: VersionSummary, change: VersionChange) => {
		setError(null);
		setSelected(`${version.id}:${change.path}`);
		try {
			const { current, previous } = await load(version);
			const binary = isBinaryFile(change.path);
			const [leftContent, rightContent] = await Promise.all([
				contentOf(entryAt(previous, change.path), binary),
				contentOf(entryAt(current, change.path), binary),
			]);
			onOpenDiff({
				file: {
					path: change.path,
					type: change.type,
					isBinary: binary,
					leftContent,
					rightContent,
				},
				leftLabel: previous ? momentOf(previous.time) : t('Before'),
				rightLabel: momentOf(version.time),
				key: `${version.id}:${change.path}`,
			});
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	// Puts a file back as it is in `entry`: a document's text through the
	// shared document, anything else as a file of the project.
	const restoreEntry = async (entry: VersionEntry & { id?: string }) => {
		const documents = data?.documents ?? [];
		const existing = await fileStoreService.getFileByPath(entry.path);
		const documentId =
			(entry.id && documents.some((doc) => doc.id === entry.id)
				? entry.id
				: undefined) ?? existing?.documentId;
		if (documentId && documents.some((doc) => doc.id === documentId)) {
			const text = await projectHistoryService.getText(
				baseUrl,
				projectId,
				entry.hash,
			);
			await collabService.updateDocumentContent(
				projectId,
				documentId,
				() => text,
			);
			return;
		}
		const content = await projectHistoryService.getContent(
			baseUrl,
			projectId,
			entry.hash,
		);
		if (existing) {
			const current =
				typeof existing.content === 'string'
					? new TextEncoder().encode(existing.content).buffer
					: existing.content;
			const unchanged =
				current &&
				(await peerFileSyncService.calculateFileChecksum(current)) ===
					entry.hash;
			if (!unchanged) {
				await fileStoreService.updateFileContent(existing.id, content);
			}
			return;
		}
		await fileStoreService.createDirectoryPath(entry.path);
		const name = entry.path.split('/').pop() || entry.path;
		await fileStoreService.storeFile(
			{
				id: nanoid(),
				name,
				path: entry.path,
				type: 'file',
				content,
				lastModified: Date.now(),
				size: content.byteLength,
				isBinary: isBinaryFile(entry.path),
				mimeType: getMimeType(entry.path),
				isDeleted: false,
			},
			{ showConflictDialog: false },
		);
	};

	const run = async (task: () => Promise<void>, done: string) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await task();
			setNotice(done);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	};

	// A deleted file comes back as it was just before.
	const restoreFile = (version: VersionSummary, change: VersionChange) =>
		run(
			async () => {
				const { current, previous } = await load(version);
				const entry = entryAt(
					change.type === 'deleted' ? previous : current,
					change.path,
				);
				if (!entry) throw new Error(t('This file is not in that version.'));
				await restoreEntry(entry);
			},
			t('{path} was restored.', { path: change.path }),
		);

	// Files added since are kept.
	const restoreVersion = (version: VersionSummary) =>
		run(async () => {
			const { current } = await load(version);
			for (const entry of [...current.docs, ...current.files]) {
				await restoreEntry(entry);
			}
		}, t('The project was restored to this version.'));

	if (!onServer) {
		return (
			<div className='git-history-panel ui-panel'>
				<p className='versions-note ui-note'>
					{t(
						'Versions are kept by the collaboration server; this project is not synchronized through it.',
					)}
				</p>
			</div>
		);
	}

	return (
		<div className='git-history-panel ui-panel versions-panel'>
			<div className='versions-header'>
				<strong>{t('Versions')}</strong>
				<button
					type='button'
					className='button secondary icon-only'
					title={t('Refresh')}
					aria-label={t('Refresh')}
					onClick={() => void refresh()}
				>
					<RefreshIcon />
				</button>
			</div>
			{error && (
				<div className='ui-message' data-tone='warning' data-density='compact'>
					{error}
				</div>
			)}
			{notice && (
				<div className='ui-message' data-tone='success' data-density='compact'>
					{notice}
				</div>
			)}
			{versions === null && !error && (
				<p className='versions-note ui-note'>{t('Loading...')}</p>
			)}
			{versions?.length === 0 && (
				<p className='versions-note ui-note'>
					{t('No version yet. A version is saved shortly after each change.')}
				</p>
			)}
			<div className='versions-list'>
				{days.map((group) => (
					<section key={group.day} className='versions-day'>
						<h4 className='versions-day-title'>{group.day}</h4>
						{group.versions.map((version) => (
							<div key={version.id} className='versions-item'>
								<div className='versions-item-head'>
									<span className='versions-time'>{timeOf(version.time)}</span>
									<span
										className='versions-authors'
										title={version.authors.join(', ')}
									>
										{version.authors.join(', ') || t('Unknown author')}
									</span>
									{!readOnly && (
										<button
											type='button'
											className='button secondary'
											disabled={busy}
											title={t(
												'Restore every file of the project as it was in this version; files added since are kept.',
											)}
											onClick={() => void restoreVersion(version)}
										>
											{t('Restore')}
										</button>
									)}
								</div>
								<ul className='versions-changes'>
									{version.changes.map((change) => (
										<li
											key={change.path}
											className='versions-change'
											data-selected={
												selected === `${version.id}:${change.path}` || undefined
											}
										>
											<button
												type='button'
												className='versions-change-open'
												onClick={() => void openDiff(version, change)}
											>
												<code className={`git-change-status ${change.type}`}>
													{statusLabel(change.type)}
												</code>
												<span>{change.path}</span>
											</button>
											{!readOnly && (
												<button
													type='button'
													className='button secondary icon-only'
													disabled={busy}
													title={
														change.type === 'deleted'
															? t(
																	'Restore this file as it was before it was deleted',
																)
															: t('Restore this file as it was in this version')
													}
													aria-label={t('Restore this file')}
													onClick={() => void restoreFile(version, change)}
												>
													<UndoIcon />
												</button>
											)}
										</li>
									))}
								</ul>
							</div>
						))}
					</section>
				))}
			</div>
		</div>
	);
};

export default ProjectVersionsPanel;
