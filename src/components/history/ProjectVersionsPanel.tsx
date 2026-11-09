// src/components/history/ProjectVersionsPanel.tsx
import { nanoid } from 'nanoid';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { useCollab } from '../../hooks/useCollab';
import { useSettings } from '../../hooks/useSettings';
import { collabService } from '../../services/CollabService';
import { fileStoreService } from '../../services/FileStoreService';
import { peerFileSyncService } from '../../services/PeerFileSyncService';
import {
	type ProjectVersion,
	type VersionChange,
	type VersionEntry,
	type VersionLabel,
	type VersionSummary,
	projectHistoryService,
} from '../../services/ProjectHistoryService';
import type { DocumentList } from '../../types/documents';
import {
	createArchiveBlob,
	downloadArchiveFile,
} from '../../utils/archiveUtils';
import { getMimeType, isBinaryFile } from '../../utils/fileUtils';
import { collabHttpBaseUrl } from '../../utils/serverFileSyncUtils';
import {
	versionArchiveEntries,
	versionArchiveName,
} from '../../utils/versionArchive';
import {
	CloseIcon,
	DownloadIcon,
	RefreshIcon,
	ToolbarLabelIcon,
	UndoIcon,
} from '../common/Icons';
import type { GitDiffView } from './GitDiffViewer';

const REFRESH_MS = 30_000;

interface ProjectVersionsPanelProps {
	projectId: string;
	onOpenDiff: (view: GitDiffView) => void;
	onClearDiff: () => void;
}

const statusLabel = (type: VersionChange['type']): string =>
	type === 'added' ? 'A' : type === 'deleted' ? 'D' : 'M';

// A formatter made once: toLocaleString makes one at each call, which for
// a thousand versions at each render made ticking a version take a second.
const dateFormat = (options: Intl.DateTimeFormatOptions) => {
	let format: Intl.DateTimeFormat | null = null;
	return (time: number) => {
		format ??= new Intl.DateTimeFormat(undefined, options);
		return format.format(time);
	};
};

const dayOf = dateFormat({
	weekday: 'long',
	year: 'numeric',
	month: 'long',
	day: 'numeric',
});

const timeOf = dateFormat({ hour: '2-digit', minute: '2-digit' });

// Versions saved a few seconds apart differ by their seconds.
const momentOf = dateFormat({
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
});

// The latest versions first, more on request: a project kept up to 1,000.
const VERSIONS_PAGE = 50;
const VERSIONS_MORE = 100;

const entryAt = (version: ProjectVersion | null, path: string) =>
	version
		? ([...version.docs, ...version.files].find(
				(entry) => entry.path === path,
			) ?? null)
		: null;

// The files that differ between two versions.
const changesBetween = (
	older: ProjectVersion,
	newer: ProjectVersion,
): VersionChange[] => {
	const hashes = (version: ProjectVersion) =>
		new Map(
			[...version.docs, ...version.files].map((entry) => [
				entry.path,
				entry.hash,
			]),
		);
	const before = hashes(older);
	const after = hashes(newer);
	const changes: VersionChange[] = [];
	for (const [path, hash] of after) {
		if (!before.has(path)) changes.push({ path, type: 'added' });
		else if (before.get(path) !== hash)
			changes.push({ path, type: 'modified' });
	}
	for (const path of before.keys()) {
		if (!after.has(path)) changes.push({ path, type: 'deleted' });
	}
	return changes.sort((a, b) => a.path.localeCompare(b.path));
};

interface Comparison {
	older: ProjectVersion;
	newer: ProjectVersion;
	changes: VersionChange[];
}

// The list refreshed: the versions already received keep their objects, and
// the list itself when nothing came.
const keptVersions = (
	previous: VersionSummary[] | null,
	next: VersionSummary[],
): VersionSummary[] => {
	if (!previous) return next;
	const known = new Map(previous.map((version) => [version.id, version]));
	const merged = next.map((version) => known.get(version.id) ?? version);
	return merged.length === previous.length &&
		merged.every((version, index) => version === previous[index])
		? previous
		: merged;
};

interface ChangeListProps {
	changes: VersionChange[];
	selectedPath: string | null;
	busy: boolean;
	onOpen: (change: VersionChange) => void;
	onRestore?: (change: VersionChange) => void;
}

const ChangeList: React.FC<ChangeListProps> = ({
	changes,
	selectedPath,
	busy,
	onOpen,
	onRestore,
}) => (
	<ul className='versions-changes'>
		{changes.map((change) => (
			<li
				key={change.path}
				className='versions-change'
				data-selected={selectedPath === change.path || undefined}
			>
				<button
					type='button'
					className='versions-change-open'
					onClick={() => onOpen(change)}
				>
					<code className={`git-change-status ${change.type}`}>
						{statusLabel(change.type)}
					</code>
					<span>{change.path}</span>
				</button>
				{onRestore && (
					<button
						type='button'
						className='button secondary icon-only'
						disabled={busy}
						title={
							change.type === 'deleted'
								? t('Restore this file as it was before it was deleted')
								: t('Restore this file as it was in this version')
						}
						aria-label={t('Restore this file')}
						onClick={() => onRestore(change)}
					>
						<UndoIcon />
					</button>
				)}
			</li>
		))}
	</ul>
);

interface VersionActions {
	toggleCompared: (versionId: string) => void;
	download: (version: VersionSummary) => void;
	startLabel: (versionId: string) => void;
	restore: (version: VersionSummary) => void;
	removeLabel: (label: VersionLabel) => void;
	openDiff: (version: VersionSummary, change: VersionChange) => void;
	restoreFile: (version: VersionSummary, change: VersionChange) => void;
}

interface VersionItemProps {
	version: VersionSummary;
	compared: boolean;
	busy: boolean;
	readOnly: boolean;
	labels: VersionLabel[] | undefined;
	labelForm: React.ReactNode;
	selectedPath: string | null;
	actions: VersionActions;
}

// One version of the list, drawn again only when its own props change:
// ticking one of a thousand versions no longer draws them all.
const VersionItem = memo(function VersionItem({
	version,
	compared,
	busy,
	readOnly,
	labels,
	labelForm,
	selectedPath,
	actions,
}: VersionItemProps) {
	return (
		<div className='versions-item' data-compared={compared || undefined}>
			<div className='versions-item-head'>
				<input
					type='checkbox'
					className='versions-compare-check'
					checked={compared}
					onChange={() => actions.toggleCompared(version.id)}
					title={t('Compare')}
					aria-label={t('Compare')}
				/>
				<span className='versions-time'>{timeOf(version.time)}</span>
				<button
					type='button'
					className='button secondary icon-only'
					data-action='download-version'
					disabled={busy}
					title={t('Download this version (.zip)')}
					aria-label={t('Download this version (.zip)')}
					onClick={() => actions.download(version)}
				>
					<DownloadIcon />
				</button>
				{!readOnly && (
					<>
						<button
							type='button'
							className='button secondary icon-only'
							title={t('Label this version')}
							aria-label={t('Label this version')}
							onClick={() => actions.startLabel(version.id)}
						>
							<ToolbarLabelIcon />
						</button>
						<button
							type='button'
							className='button secondary'
							disabled={busy}
							title={t(
								'Restore every file of the project as it was in this version; files added since are kept.',
							)}
							onClick={() => actions.restore(version)}
						>
							{t('Restore')}
						</button>
					</>
				)}
			</div>
			<div className='versions-authors' title={version.authors.join(', ')}>
				{version.authors.join(', ') || t('Unknown author')}
			</div>
			{labels && labels.length > 0 && (
				<ul className='versions-labels'>
					{labels.map((label) => (
						<li
							key={label.id}
							className='versions-label'
							title={
								label.by
									? t('Labelled by {name}', { name: label.by })
									: undefined
							}
						>
							<ToolbarLabelIcon />
							<span>{label.name}</span>
							{!readOnly && (
								<button
									type='button'
									className='versions-label-remove'
									disabled={busy}
									title={t('Remove label')}
									aria-label={t('Remove label')}
									onClick={() => actions.removeLabel(label)}
								>
									<CloseIcon />
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{labelForm}
			<ChangeList
				changes={version.changes}
				selectedPath={selectedPath}
				busy={busy}
				onOpen={(change) => actions.openDiff(version, change)}
				onRestore={
					readOnly
						? undefined
						: (change) => actions.restoreFile(version, change)
				}
			/>
		</div>
	);
});

/**
 * The versions the collaboration server saved of the project, as on
 * Overleaf: who changed what and when, each change shown against the version
 * before it or any two versions compared, versions labelled, and any file or
 * the whole project restored as it was.
 */
const ProjectVersionsPanel: React.FC<ProjectVersionsPanelProps> = ({
	projectId,
	onOpenDiff,
	onClearDiff,
}) => {
	const { data, readOnly } = useCollab<DocumentList>();
	const { user } = useAuth();
	const { getSetting } = useSettings();
	const onServer = getSetting('collab-provider-type')?.value === 'websocket';
	const websocketServer =
		(getSetting('collab-websocket-server')?.value as string | undefined) ?? '';
	const baseUrl = onServer ? collabHttpBaseUrl(websocketServer) : '';
	const [versions, setVersions] = useState<VersionSummary[] | null>(null);
	const [labels, setLabels] = useState<VersionLabel[]>([]);
	const [onlyLabelled, setOnlyLabelled] = useState(false);
	// The version being labelled, or 'now' for the project as it is.
	const [labelling, setLabelling] = useState<string | null>(null);
	const [labelName, setLabelName] = useState('');
	// Up to two versions to compare with each other.
	const [compared, setCompared] = useState<string[]>([]);
	const [comparison, setComparison] = useState<Comparison | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// How many versions the list shows, by project and tab.
	const listKey = `${projectId}:${onlyLabelled}`;
	const [listed, setListed] = useState<Record<string, number>>({});
	const shownCount = listed[listKey] ?? VERSIONS_PAGE;

	const refresh = useCallback(async () => {
		if (!baseUrl) return;
		try {
			const history = await projectHistoryService.loadHistory(
				baseUrl,
				projectId,
			);
			// A saved version never changes: the rows keep theirs, and
			// redraw only for what came.
			setVersions((previous) => keptVersions(previous, history.versions));
			setLabels((previous) =>
				JSON.stringify(previous) === JSON.stringify(history.labels)
					? previous
					: history.labels,
			);
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

	const labelsOf = useMemo(() => {
		const byVersion = new Map<string, VersionLabel[]>();
		for (const label of labels) {
			byVersion.set(label.version, [
				...(byVersion.get(label.version) ?? []),
				label,
			]);
		}
		return byVersion;
	}, [labels]);

	const listedVersions = useMemo(
		() =>
			(versions ?? []).filter(
				(version) => !onlyLabelled || labelsOf.has(version.id),
			),
		[versions, onlyLabelled, labelsOf],
	);
	const olderCount = Math.max(0, listedVersions.length - shownCount);

	const days = useMemo(() => {
		const groups: Array<{ day: string; versions: VersionSummary[] }> = [];
		for (const version of listedVersions.slice(0, shownCount)) {
			const day = dayOf(version.time);
			const last = groups[groups.length - 1];
			if (last?.day === day) last.versions.push(version);
			else groups.push({ day, versions: [version] });
		}
		return groups;
	}, [listedVersions, shownCount]);

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

	// A file as it changed from `older` (none: before the first version) to
	// `newer`.
	const showDiff = async (
		older: ProjectVersion | null,
		newer: ProjectVersion,
		change: VersionChange,
		key: string,
	) => {
		setError(null);
		setSelected(key);
		try {
			const binary = isBinaryFile(change.path);
			const [leftContent, rightContent] = await Promise.all([
				contentOf(entryAt(older, change.path), binary),
				contentOf(entryAt(newer, change.path), binary),
			]);
			onOpenDiff({
				file: {
					path: change.path,
					type: change.type,
					isBinary: binary,
					leftContent,
					rightContent,
				},
				leftLabel: older ? momentOf(older.time) : t('Before'),
				rightLabel: momentOf(newer.time),
				key,
			});
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const openDiff = async (version: VersionSummary, change: VersionChange) => {
		try {
			const { current, previous } = await load(version);
			await showDiff(previous, current, change, `${version.id}:${change.path}`);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const toggleCompared = (versionId: string) =>
		setCompared((current) =>
			current.includes(versionId)
				? current.filter((id) => id !== versionId)
				: [...current, versionId].slice(-2),
		);

	useEffect(() => {
		if (compared.length !== 2 || !baseUrl) {
			setComparison(null);
			return;
		}
		let cancelled = false;
		void Promise.all(
			compared.map((id) =>
				projectHistoryService.getVersion(baseUrl, projectId, id),
			),
		)
			.then(([first, second]) => {
				if (cancelled) return;
				const [older, newer] =
					first.time <= second.time ? [first, second] : [second, first];
				setComparison({ older, newer, changes: changesBetween(older, newer) });
			})
			.catch((caught) => {
				if (!cancelled) {
					setError(caught instanceof Error ? caught.message : String(caught));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [compared, baseUrl, projectId]);

	const startLabel = (target: string) => {
		setLabelling((current) => (current === target ? null : target));
		setLabelName('');
	};

	const addLabel = async (event: React.FormEvent) => {
		event.preventDefault();
		const name = labelName.trim();
		if (!name || !labelling) return;
		await run(
			async () => {
				await projectHistoryService.addLabel(baseUrl, projectId, {
					name,
					by: user?.username ?? '',
					...(labelling === 'now' ? {} : { version: labelling }),
				});
				setLabelling(null);
				setLabelName('');
				await refresh();
			},
			t('The label {name} was added.', { name }),
		);
	};

	const removeLabel = (label: VersionLabel) =>
		run(
			async () => {
				await projectHistoryService.removeLabel(baseUrl, projectId, label.id);
				await refresh();
			},
			t('The label {name} was removed.', { name: label.name }),
		);

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

	// The project as it was in a version, as a ZIP, as on Overleaf.
	const downloadVersion = (version: VersionSummary) =>
		run(async () => {
			const full = await projectHistoryService.getVersion(
				baseUrl,
				projectId,
				version.id,
			);
			const entries = await versionArchiveEntries(full, (hash) =>
				projectHistoryService.getContent(baseUrl, projectId, hash),
			);
			downloadArchiveFile(
				await createArchiveBlob(entries),
				versionArchiveName(
					data?.projectMetadata?.name ?? '',
					version.time,
					labelsOf.get(version.id)?.[0]?.name,
				),
			);
		}, t('The version was downloaded.'));

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

	// The rows' actions, the same functions from one render to the next.
	const actionsRef = useRef<VersionActions | null>(null);
	actionsRef.current = {
		toggleCompared,
		download: (version) => void downloadVersion(version),
		startLabel,
		restore: (version) => void restoreVersion(version),
		removeLabel: (label) => void removeLabel(label),
		openDiff: (version, change) => void openDiff(version, change),
		restoreFile: (version, change) => void restoreFile(version, change),
	};
	const actions = useMemo<VersionActions>(
		() => ({
			toggleCompared: (id) => actionsRef.current?.toggleCompared(id),
			download: (version) => actionsRef.current?.download(version),
			startLabel: (id) => actionsRef.current?.startLabel(id),
			restore: (version) => actionsRef.current?.restore(version),
			removeLabel: (label) => actionsRef.current?.removeLabel(label),
			openDiff: (version, change) =>
				actionsRef.current?.openDiff(version, change),
			restoreFile: (version, change) =>
				actionsRef.current?.restoreFile(version, change),
		}),
		[],
	);

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

	const labelForm = (
		<form className='versions-label-form' onSubmit={addLabel}>
			<input
				id='versions-label-name'
				className='ui-field-control'
				type='text'
				maxLength={100}
				placeholder={t('Label name')}
				aria-label={t('Label name')}
				value={labelName}
				onChange={(event) => setLabelName(event.target.value)}
				// biome-ignore lint/a11y/noAutofocus: the form opens on request.
				autoFocus
			/>
			<button
				type='submit'
				className='button primary'
				disabled={busy || !labelName.trim()}
			>
				{t('Add')}
			</button>
			<button
				type='button'
				className='button secondary'
				onClick={() => setLabelling(null)}
			>
				{t('Cancel')}
			</button>
		</form>
	);

	return (
		<div className='git-history-panel ui-panel versions-panel'>
			<div className='versions-header'>
				<div className='versions-tabs' role='tablist'>
					<button
						type='button'
						role='tab'
						aria-selected={!onlyLabelled}
						className={`ui-tab${onlyLabelled ? '' : ' active'}`}
						onClick={() => setOnlyLabelled(false)}
					>
						{t('All history')}
					</button>
					<button
						type='button'
						role='tab'
						aria-selected={onlyLabelled}
						className={`ui-tab${onlyLabelled ? ' active' : ''}`}
						onClick={() => setOnlyLabelled(true)}
					>
						{t('Labels')}
					</button>
				</div>
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
			{!readOnly &&
				(labelling === 'now' ? (
					labelForm
				) : (
					<div className='versions-label-now'>
						<button
							type='button'
							className='button secondary'
							title={t('Label the project as it is now')}
							onClick={() => startLabel('now')}
						>
							<ToolbarLabelIcon />
							<span>{t('Add a label')}</span>
						</button>
					</div>
				))}
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
			{compared.length > 0 && (
				<div className='versions-compare'>
					<div className='versions-compare-head'>
						<strong>{t('Comparison')}</strong>
						<span className='ui-meta'>
							{comparison
								? `${momentOf(comparison.older.time)} → ${momentOf(comparison.newer.time)}`
								: compared.length === 1
									? t('Tick another version to compare them.')
									: t('Loading...')}
						</span>
						<button
							type='button'
							className='button secondary icon-only'
							title={t('Stop comparing')}
							aria-label={t('Stop comparing')}
							onClick={() => setCompared([])}
						>
							<CloseIcon />
						</button>
					</div>
					{comparison &&
						(comparison.changes.length === 0 ? (
							<p className='ui-note'>
								{t('These versions hold the same files.')}
							</p>
						) : (
							<ChangeList
								changes={comparison.changes}
								selectedPath={
									selected?.startsWith('compare:')
										? selected.slice('compare:'.length)
										: null
								}
								busy={busy}
								onOpen={(change) =>
									void showDiff(
										comparison.older,
										comparison.newer,
										change,
										`compare:${change.path}`,
									)
								}
							/>
						))}
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
			{versions && versions.length > 0 && onlyLabelled && days.length === 0 && (
				<p className='versions-note ui-note'>{t('No labelled version yet.')}</p>
			)}
			<div className='versions-list'>
				{days.map((group) => (
					<section key={group.day} className='versions-day'>
						<h4 className='versions-day-title'>{group.day}</h4>
						{group.versions.map((version) => (
							<VersionItem
								key={version.id}
								version={version}
								compared={compared.includes(version.id)}
								busy={busy}
								readOnly={Boolean(readOnly)}
								labels={labelsOf.get(version.id)}
								labelForm={labelling === version.id ? labelForm : null}
								selectedPath={
									selected?.startsWith(`${version.id}:`)
										? selected.slice(version.id.length + 1)
										: null
								}
								actions={actions}
							/>
						))}
					</section>
				))}
				{olderCount > 0 && (
					<button
						type='button'
						className='button secondary git-history-show-older'
						data-action='show-older-versions'
						onClick={() =>
							setListed((counts) => ({
								...counts,
								[listKey]: shownCount + VERSIONS_MORE,
							}))
						}
					>
						{t('Show older versions ({count} more)', { count: olderCount })}
					</button>
				)}
			</div>
		</div>
	);
};

export default ProjectVersionsPanel;
