// src/services/FileImportService.ts
// Files added to the open project from another project on this device or
// from a URL, as Overleaf's "From another project" and "From external URL".
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { t } from '@/i18n';
import type { ImportedFileSource, ProjectMetadata } from '../types/documents';
import type { FileNode } from '../types/files';
import type { Project } from '../types/projects';
import {
	chooseLatexMainFile,
	collectValues,
	isRootLatexDocument,
} from '../utils/compilerUtils';
import { cleanBytes } from '../utils/fileCommentUtils';
import { isTemporaryFile } from '../utils/fileUtils';
import { urlFetchErrorMessage } from '../utils/fileImportUtils';
import { sharedFieldValue } from '../utils/projectCompileSettings';
import { TEXLIVE_TYPESETTER_ID } from '../utils/texliveTypesetter';
import { accountSyncService } from './AccountSyncService';
import { authService } from './AuthService';
import { fileStoreService } from './FileStoreService';
import {
	type TypesetterFile,
	genericTypesetterService,
} from './GenericTypesetterService';
import { typesetterRegistryService } from './TypesetterRegistryService';

const DOCUMENT_LOAD_MS = 2000;
const DIRECT_TIMEOUT_MS = 20_000;
const SERVER_TIMEOUT_MS = 5 * 60_000;

export class FileImportError extends Error {}

const projectIdOf = (project: Project): string =>
	project.docUrl.split(':').pop() ?? '';

const bytesOf = (content: string | ArrayBuffer): ArrayBuffer =>
	typeof content === 'string'
		? new TextEncoder().encode(content).buffer
		: content;

class FileImportService {
	/** The account's other projects, by name, as Overleaf lists them. */
	async listProjects(currentProjectId: string): Promise<Project[]> {
		const projects = await authService.getProjects();
		return projects
			.filter(
				(project) =>
					project.id !== currentProjectId &&
					Boolean(projectIdOf(project)) &&
					!project.trashedAt,
			)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** A project's files on this device, without the app's own. */
	async listFiles(project: Project): Promise<FileNode[]> {
		const files = await fileStoreService.getProjectFiles(projectIdOf(project));
		return files
			.filter((file) => !isTemporaryFile(file.path))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	/**
	 * A file of another project. A file linked to a document has its text in
	 * the document, which may be newer than the file.
	 */
	async readFile(project: Project, file: FileNode): Promise<ArrayBuffer> {
		const projectId = projectIdOf(project);
		if (file.documentId) {
			const text = await this.readDocument(projectId, file.documentId);
			if (text) return bytesOf(text);
		}
		const stored = await fileStoreService.getProjectFile(projectId, file.id);
		if (stored?.content === undefined) {
			throw new FileImportError(t('This file has no content on this device.'));
		}
		return bytesOf(stored.content);
	}

	private readDocument(projectId: string, documentId: string): Promise<string> {
		return this.readStored(projectId, `yjs_${documentId}`, (doc) =>
			doc.getText('codemirror').toString(),
		);
	}

	/** Another project's settings, as last saved on this device. */
	private readProjectMetadata(
		projectId: string,
	): Promise<ProjectMetadata | undefined> {
		return this.readStored(projectId, 'yjs_metadata', (doc) => {
			const stored = doc.getMap('data').get('projectMetadata');
			return stored
				? (JSON.parse(JSON.stringify(stored)) as ProjectMetadata)
				: undefined;
		});
	}

	/** Reads one of another project's shared documents from this device. */
	private async readStored<T>(
		projectId: string,
		collection: string,
		read: (doc: Y.Doc) => T,
	): Promise<T> {
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(
			`texlyre-project-${projectId}-${collection}`,
			doc,
		);
		try {
			await Promise.race([
				persistence.whenSynced,
				new Promise((resolve) => setTimeout(resolve, DOCUMENT_LOAD_MS)),
			]);
			return read(doc);
		} finally {
			await persistence.destroy();
			doc.destroy();
		}
	}

	/** Whether another project's PDF can be taken: TeX Live compiles it. */
	canCompileOutputs(): boolean {
		return typesetterRegistryService.get(TEXLIVE_TYPESETTER_ID) !== undefined;
	}

	/**
	 * The PDF another project compiles to, compiled now with TeX Live, its
	 * main document and its compiler, as Overleaf compiles a project to take
	 * its output files.
	 */
	async compileOutput(project: Project): Promise<ArrayBuffer> {
		const provider = typesetterRegistryService.get(TEXLIVE_TYPESETTER_ID);
		if (!provider) {
			throw new FileImportError(
				t(
					'Taking the PDF of another project needs the TeX Live compile server.',
				),
			);
		}
		const projectId = projectIdOf(project);
		const nodes = (await fileStoreService.getProjectFiles(projectId)).filter(
			(node) => !isTemporaryFile(node.path),
		);
		if (nodes.length === 0) {
			throw new FileImportError(
				t(
					'The project {name} has no files on this device. Open it here once first.',
					{ name: project.name },
				),
			);
		}

		// Its files, documents with their latest text, without annotations.
		const files: TypesetterFile[] = [];
		for (const node of nodes) {
			const content = await this.readFile(project, node).catch(() => null);
			if (!content) continue;
			files.push({
				path: node.path,
				content: node.isBinary ? new Uint8Array(content) : cleanBytes(content),
			});
		}
		const texts = new Map(files.map((file) => [file.path, file.content]));
		const texFiles = files
			.map((file) => file.path)
			.filter((path) => path.toLowerCase().endsWith('.tex'));

		const metadata = await this.readProjectMetadata(projectId);
		const mainFile =
			metadata?.mainFile && texFiles.includes(metadata.mainFile)
				? metadata.mainFile
				: await chooseLatexMainFile(
						undefined,
						undefined,
						texFiles,
						async (path) =>
							isRootLatexDocument(new TextDecoder().decode(texts.get(path))),
					);
		if (!mainFile) {
			throw new FileImportError(
				t('The project {name} has no LaTeX document to compile.', {
					name: project.name,
				}),
			);
		}

		const fields = provider.ui?.compile?.fields ?? [];
		const { options } = collectValues(fields, (key) => {
			const field = fields.find((entry) => entry.key === key);
			return field?.shared
				? sharedFieldValue(metadata, provider.id, field)
				: undefined;
		});
		const result = await genericTypesetterService
			.compileSeparately(provider.id, {
				mainFile,
				format: 'pdf',
				files,
				options,
			})
			.catch(() => {
				throw new FileImportError(
					t('The TeX Live compile server could not be reached.'),
				);
			});
		if (!result.output) {
			throw new FileImportError(
				t('The project {name} did not compile. Open it to see its log.', {
					name: project.name,
				}),
			);
		}
		const { output } = result;
		return output.buffer.slice(
			output.byteOffset,
			output.byteOffset + output.byteLength,
		) as ArrayBuffer;
	}

	/** Where another project's PDF comes from, to compile it again. */
	outputSource(project: Project): ImportedFileSource {
		return {
			kind: 'output',
			projectId: projectIdOf(project),
			projectName: project.name,
		};
	}

	/**
	 * A file from the web, downloaded by the collaboration server for a
	 * signed-in account, as on Overleaf. Without one, or with a server that
	 * cannot, the browser downloads it if the site lets pages do so.
	 */
	async fetchUrl(url: string): Promise<ArrayBuffer> {
		let response: Response | null = null;
		try {
			response = await accountSyncService.fetchThroughServer(
				url,
				AbortSignal.timeout(SERVER_TIMEOUT_MS),
			);
		} catch {}
		if (response?.ok) return this.read(response);
		if (response) {
			const result = await response.json().catch(() => ({}));
			// A server older than this page has no /fetch.
			if (result?.error || response.status !== 404) {
				throw new FileImportError(
					urlFetchErrorMessage(result?.error ?? '', result?.status),
				);
			}
		}

		let direct: Response;
		try {
			direct = await fetch(url, {
				credentials: 'omit',
				signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
			});
		} catch {
			throw new FileImportError(
				accountSyncService.isLinked()
					? urlFetchErrorMessage('fetch_failed')
					: t(
							'This site does not let web pages download its files. Sign in to a server account to fetch files from any site.',
						),
			);
		}
		if (!direct.ok) {
			throw new FileImportError(
				urlFetchErrorMessage('upstream_status', direct.status),
			);
		}
		return this.read(direct);
	}

	/** Where a file taken from another project comes from, to refresh it. */
	projectSource(project: Project, file: FileNode): ImportedFileSource {
		return {
			kind: 'project',
			projectId: projectIdOf(project),
			projectName: project.name,
			path: file.path,
		};
	}

	/** The latest content of where an imported file came from. */
	async fetchSource(source: ImportedFileSource): Promise<ArrayBuffer> {
		if (source.kind === 'url') return this.fetchUrl(source.url);
		const project = (await authService.getProjects()).find(
			(entry) => projectIdOf(entry) === source.projectId,
		);
		if (!project) {
			throw new FileImportError(
				t('The project {name} is not on this device.', {
					name: source.projectName,
				}),
			);
		}
		if (source.kind === 'output') return this.compileOutput(project);
		const files = await fileStoreService.getProjectFiles(source.projectId);
		const file = files.find((entry) => entry.path === source.path);
		if (!file) {
			throw new FileImportError(
				files.length === 0
					? t(
							'The project {name} has no files on this device. Open it here once to refresh this file.',
							{ name: project.name },
						)
					: t('The file {path} is no longer in the project {name}.', {
							path: source.path.replace(/^\//, ''),
							name: project.name,
						}),
			);
		}
		return this.readFile(project, file);
	}

	private async read(response: Response): Promise<ArrayBuffer> {
		try {
			return await response.arrayBuffer();
		} catch {
			throw new FileImportError(urlFetchErrorMessage('fetch_failed'));
		}
	}
}

export const fileImportService = new FileImportService();
