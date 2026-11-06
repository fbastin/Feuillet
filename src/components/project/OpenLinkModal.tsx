// src/components/project/OpenLinkModal.tsx
// « Ouvrir dans Feuillet », as Overleaf's "Open in Overleaf": a page linked
// to /docs, or posted a form there, with LaTeX code or files' addresses
// (server/collab/docs.js). The person sees what the link holds and creates
// the project, which then opens; nothing is made without asking.
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { useProperties } from '../../hooks/useProperties';
import {
	localFieldPropertyId,
	localMainFilePropertyId,
} from '../../hooks/useProjectCompileSettings';
import { writeVisualPreference } from '../../extensions/codemirror/VisualLatexExtension';
import { accountSyncService } from '../../services/AccountSyncService';
import { fileImportService } from '../../services/FileImportService';
import { fileStoreService } from '../../services/FileStoreService';
import type { FileNode } from '../../types/files';
import {
	batchExtractArchive,
	normalizeProjectArchiveEntries,
} from '../../utils/archiveUtils';
import { getMimeType, isBinaryFile } from '../../utils/fileUtils';
import {
	ENGINE_OF,
	type OpenLinkRequest,
	dataUrlBytes,
	describeSource,
	isZip,
	mainDocumentOf,
	parseOpenLinkRequest,
	projectNameOf,
	sourceFileName,
	wrapSnippet,
} from '../../utils/openLink';
import { TEXLIVE_TYPESETTER_ID } from '../../utils/texliveTypesetter';
import { LinkIcon } from '../common/Icons';
import Modal from '../common/Modal';

/** A request read in the page's own address (utils/urlProjectLink.ts). */
export interface LocalOpenLink {
	request: OpenLinkRequest;
	name?: string;
	projectType?: 'latex' | 'typst';
}

interface OpenLinkModalProps {
	/** A request kept by the server for a link to /docs… */
	id?: string;
	/** …or one the address held. */
	local?: LocalOpenLink;
	onClose: () => void;
	onOpenProject: (docUrl: string, projectId: string) => void;
}

const ENGINE_LABELS: Record<string, string> = {
	pdflatex: 'pdfLaTeX',
	latex: 'LaTeX',
	xelatex: 'XeLaTeX',
	lualatex: 'LuaLaTeX',
};

const errorText = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const fileNode = (path: string, bytes: Uint8Array): FileNode => {
	const name = path.split('/').pop() ?? path;
	const content = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
	return {
		id: crypto.randomUUID(),
		name,
		path,
		type: 'file',
		content,
		lastModified: Date.now(),
		size: bytes.byteLength,
		mimeType: getMimeType(name) || 'application/octet-stream',
		isBinary: isBinaryFile(name),
	};
};

const textOf = (node: FileNode): string | undefined => {
	if (!/\.tex$/i.test(node.path)) return undefined;
	if (typeof node.content === 'string') return node.content;
	if (node.content instanceof ArrayBuffer) {
		return new TextDecoder().decode(node.content);
	}
	return undefined;
};

/** A path not taken yet: « name (2).tex » after « name.tex ». */
const freePath = (path: string, taken: Set<string>): string => {
	if (!taken.has(path)) return path;
	const dot = path.lastIndexOf('.');
	const [stem, extension] =
		dot > path.lastIndexOf('/')
			? [path.slice(0, dot), path.slice(dot)]
			: [path, ''];
	for (let n = 2; ; n++) {
		const next = `${stem} (${n})${extension}`;
		if (!taken.has(next)) return next;
	}
};

/** The project's files, downloaded and unpacked. */
async function filesOf(request: OpenLinkRequest): Promise<FileNode[]> {
	const nodes: FileNode[] = [];
	const taken = new Set<string>();
	const add = (node: FileNode) => {
		if (node.type === 'directory' && taken.has(node.path)) return;
		const path = node.type === 'file' ? freePath(node.path, taken) : node.path;
		taken.add(path);
		nodes.push(
			path === node.path
				? node
				: { ...node, path, name: path.split('/').pop() ?? node.name },
		);
	};
	// LaTeX given alone, not in an archive, may need Overleaf's preamble.
	const loose: FileNode[] = [];
	for (const [index, source] of request.sources.entries()) {
		const name = sourceFileName(source, index, request.names[index]);
		let bytes: Uint8Array;
		if (source.text !== undefined) {
			bytes = new TextEncoder().encode(source.text);
		} else if (source.uri && /^data:/i.test(source.uri)) {
			try {
				bytes = dataUrlBytes(source.uri);
			} catch {
				throw new Error(t('A file in this link cannot be read.'));
			}
		} else {
			bytes = new Uint8Array(
				await fileImportService.fetchUrl(source.uri ?? ''),
			);
		}
		if (isZip(bytes, name)) {
			const archive = new File(
				[bytes as Uint8Array<ArrayBuffer>],
				/\.zip$/i.test(name) ? name : `${name}.zip`,
				{
					type: 'application/zip',
				},
			);
			const { files, directories } = await batchExtractArchive(archive, '/');
			for (const node of normalizeProjectArchiveEntries([
				...directories,
				...files,
			])) {
				add(node);
			}
		} else {
			const node = fileNode(`/${name}`, bytes);
			add(node);
			loose.push(nodes[nodes.length - 1]);
		}
	}
	const latex = nodes.filter(
		(node) => node.type === 'file' && /\.tex$/i.test(node.path),
	);
	const hasDocument = latex.some((node) => {
		const text = textOf(node);
		return text !== undefined && /^[^%\n]*\\documentclass\b/m.test(text);
	});
	if (!hasDocument && latex.length === 1 && loose.includes(latex[0])) {
		const node = latex[0];
		const wrapped = new TextEncoder().encode(wrapSnippet(textOf(node) ?? ''));
		nodes[nodes.indexOf(node)] = {
			...fileNode(node.path, wrapped),
			id: node.id,
		};
	}
	return nodes;
}

const OpenLinkModal: React.FC<OpenLinkModalProps> = ({
	id,
	local,
	onClose,
	onOpenProject,
}) => {
	const { createProject } = useAuth();
	const { setProperty } = useProperties();
	const [request, setRequest] = useState<OpenLinkRequest | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [visual, setVisual] = useState(false);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let current = true;
		setRequest(null);
		setLoadError(null);
		if (local) {
			setRequest(local.request);
			setName(
				local.name?.trim() || projectNameOf(local.request, t('LaTeX snippet')),
			);
			return;
		}
		if (!id) return;
		void (async () => {
			try {
				const response = await fetch(
					`${accountSyncService.serverFor()}/docs/${encodeURIComponent(id)}`,
					{ credentials: 'omit', cache: 'no-store' },
				);
				if (response.status === 404) {
					throw new Error(
						t(
							'This link has expired: open it again from the page it came from.',
						),
					);
				}
				const parsed = response.ok
					? parseOpenLinkRequest(await response.json())
					: null;
				if (!parsed) {
					throw new Error(t('The server could not give what this link holds.'));
				}
				if (!current) return;
				setRequest(parsed);
				setName(projectNameOf(parsed, t('LaTeX snippet')));
				setVisual(parsed.visualEditor === true);
			} catch (caught) {
				if (current) {
					setLoadError(
						caught instanceof TypeError
							? t('The server could not give what this link holds.')
							: errorText(caught),
					);
				}
			}
		})();
		return () => {
			current = false;
		};
	}, [id, local]);

	const engine = request?.engine ? ENGINE_OF[request.engine] : undefined;
	const sources = useMemo(
		() =>
			request?.sources.map((source, index) => ({
				name: sourceFileName(source, index, request.names[index]),
				...describeSource(source),
			})) ?? [],
		[request],
	);

	const create = async () => {
		if (!request || !name.trim() || creating) return;
		setCreating(true);
		setError(null);
		try {
			const files = await filesOf(request);
			// An address may name only a project, as TeXlyre's do.
			if (
				request.sources.length > 0 &&
				!files.some((node) => node.type === 'file')
			) {
				throw new Error(t('This link holds no file.'));
			}
			const project = await createProject({
				name: name.trim(),
				description: '',
				type: local?.projectType ?? 'latex',
				tags: [],
				isFavorite: false,
			});
			await fileStoreService.initialize(project.docUrl);
			await fileStoreService.batchStoreFiles(files, {
				showConflictDialog: false,
				preserveTimestamp: false,
			});
			// Chosen for the project here, they become its settings once it
			// opens (useProjectCompileSettings).
			const projectId =
				fileStoreService.getCurrentProjectId() ||
				project.docUrl.replace(/^yjs:/, '');
			const scope = { scope: 'project' as const, projectId };
			const main = mainDocumentOf(
				files
					.filter((node) => node.type === 'file')
					.map((node) => ({ path: node.path, text: textOf(node) })),
				request.mainDocument,
			);
			if (main) {
				setProperty(
					localMainFilePropertyId(TEXLIVE_TYPESETTER_ID),
					main,
					scope,
				);
			}
			if (engine) {
				setProperty(
					localFieldPropertyId(TEXLIVE_TYPESETTER_ID, 'engine'),
					engine,
					scope,
				);
			}
			if (visual) writeVisualPreference(true);
			onOpenProject(project.docUrl, project.id);
		} catch (caught) {
			setError(errorText(caught));
			setCreating(false);
		}
	};

	return (
		<Modal
			isOpen
			onClose={creating ? () => {} : onClose}
			title={t('Open in {app}', { app: APP_NAME })}
			icon={LinkIcon}
			size='medium'
		>
			<div className='ui-stack' data-gap='md' data-role='open-link'>
				{loadError ? (
					<div
						className='ui-message'
						data-tone='error'
						data-role='open-link-error'
					>
						{loadError}
					</div>
				) : !request ? (
					<p className='ui-note'>{t('Loading...')}</p>
				) : (
					<>
						<p>
							{t(
								'This link creates a project with these files. Create it if you trust the page it came from.',
							)}
						</p>
						<div className='ui-list' data-role='open-link-files'>
							{sources.map((source, index) => (
								<div
									key={index}
									className='ui-list-item'
									data-appearance='flat'
									data-padding='sm'
								>
									<div
										className='ui-list-content'
										data-grow='true'
										data-gap='xs'
									>
										<strong>{source.name}</strong>
										<span className='ui-note'>
											{source.kind === 'text'
												? t('LaTeX code, {count} lines', {
														count: source.lines,
													})
												: source.host
													? t('From {host}', { host: source.host })
													: t('Included in the link')}
										</span>
									</div>
								</div>
							))}
						</div>
						<div className='ui-field'>
							<label htmlFor='open-link-project-name'>
								{t('Project Name')}
								<span className='required'>*</span>
							</label>
							<input
								type='text'
								id='open-link-project-name'
								value={name}
								onChange={(event) => setName(event.target.value)}
								disabled={creating}
							/>
						</div>
						{engine && (
							<p className='ui-meta' data-role='open-link-engine'>
								{t('Compiler: {compiler}', {
									compiler: ENGINE_LABELS[engine] ?? engine,
								})}
							</p>
						)}
						{request.visualEditor && (
							<label className='checkbox-control'>
								<input
									type='checkbox'
									data-role='open-link-visual'
									checked={visual}
									onChange={(event) => setVisual(event.target.checked)}
									disabled={creating}
								/>
								<span>{t('Show LaTeX documents in the visual editor')}</span>
							</label>
						)}
						{error && (
							<div
								className='ui-message'
								data-tone='error'
								data-role='open-link-error'
							>
								{error}
							</div>
						)}
					</>
				)}
				<div
					className='ui-actions'
					data-variant='modal'
					data-align='end'
					data-cross='stretch'
				>
					<button
						type='button'
						className='button secondary'
						onClick={onClose}
						disabled={creating}
					>
						{t('Cancel')}
					</button>
					{request && (
						<button
							type='button'
							className='button primary'
							data-action='create-from-link'
							onClick={() => void create()}
							disabled={!name.trim() || creating}
						>
							{creating ? t('Creating...') : t('Create Project')}
						</button>
					)}
				</div>
			</div>
		</Modal>
	);
};

export default OpenLinkModal;
