// src/services/ProjectSeedService.ts
import type { FileNode } from '../types/files';
import type { ProjectType } from '../types/projects';
import {
	batchExtractArchive,
	normalizeProjectArchiveEntries,
} from '../utils/archiveUtils';
import { fileStoreService } from './FileStoreService';

const ARCHIVE_EXTENSION = /\.(zip|tar\.gz|tgz|tar|7z|rar)$/i;

const textOf = (file: FileNode): string =>
	typeof file.content === 'string'
		? file.content
		: file.content
			? new TextDecoder().decode(file.content)
			: '';

class ProjectSeedService {
	/** Writes files into a project that is not open in the editor yet. */
	async storeFiles(projectId: string, files: FileNode[]): Promise<void> {
		if (files.length === 0) return;
		await fileStoreService.initialize(`yjs:${projectId}`);
		await fileStoreService.batchStoreFiles(files, {
			showConflictDialog: false,
			preserveTimestamp: false,
		});
	}

	async filesFromArchive(archive: File): Promise<FileNode[]> {
		const { files, directories } = await batchExtractArchive(archive, '/');
		return normalizeProjectArchiveEntries([...directories, ...files]);
	}

	projectNameFromArchive(fileName: string): string {
		return fileName.replace(ARCHIVE_EXTENSION, '').trim() || fileName;
	}

	detectProjectType(files: FileNode[]): ProjectType {
		const names = files.filter((file) => file.type === 'file');
		if (names.some((file) => file.name.endsWith('.tex'))) return 'latex';
		if (names.some((file) => file.name.endsWith('.typ'))) return 'typst';
		return 'latex';
	}

	/** Best guess of the document to open first, like Overleaf's main file. */
	findMainFile(files: FileNode[], type: ProjectType): string | null {
		const extension = type === 'typst' ? '.typ' : '.tex';
		const candidates = files
			.filter((file) => file.type === 'file' && file.name.endsWith(extension))
			.sort(
				(a, b) =>
					a.path.split('/').length - b.path.split('/').length ||
					a.path.localeCompare(b.path),
			);
		const preferred = candidates.find(
			(file) => file.name === `main${extension}`,
		);
		if (preferred) return preferred.path;
		if (type === 'typst') return candidates[0]?.path ?? null;
		return (
			candidates.find((file) => textOf(file).includes('\\documentclass'))
				?.path ??
			candidates[0]?.path ??
			null
		);
	}
}

export const projectSeedService = new ProjectSeedService();
