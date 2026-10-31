// src/services/FileImportService.ts
// Files added to the open project from another project on this device or
// from a URL, as Overleaf's "From another project" and "From external URL".
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { t } from '@/i18n';
import type { ImportedFileSource } from '../types/documents';
import type { FileNode } from '../types/files';
import type { Project } from '../types/projects';
import { isTemporaryFile } from '../utils/fileUtils';
import { urlFetchErrorMessage } from '../utils/fileImportUtils';
import { accountSyncService } from './AccountSyncService';
import { authService } from './AuthService';
import { fileStoreService } from './FileStoreService';

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

	private async readDocument(
		projectId: string,
		documentId: string,
	): Promise<string> {
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(
			`texlyre-project-${projectId}-yjs_${documentId}`,
			doc,
		);
		try {
			await Promise.race([
				persistence.whenSynced,
				new Promise((resolve) => setTimeout(resolve, DOCUMENT_LOAD_MS)),
			]);
			return doc.getText('codemirror').toString();
		} finally {
			await persistence.destroy();
			doc.destroy();
		}
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
