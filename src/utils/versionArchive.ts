// src/utils/versionArchive.ts
// A copy of the project as it was in a version of its history, as Overleaf
// offers to download: its files in a ZIP, without the tags of comments and
// tracked changes, which only Feuillet reads.
import type { ProjectVersion } from '../services/ProjectHistoryService';
import type { ArchiveEntry } from './archiveUtils';
import { cleanBytes } from './fileCommentUtils';
import { isBinaryFile, isTemporaryFile } from './fileUtils';

/** The files of a version, documents taking over files at the same path. */
export async function versionArchiveEntries(
	version: Pick<ProjectVersion, 'docs' | 'files'>,
	read: (hash: string) => Promise<ArrayBuffer>,
): Promise<ArchiveEntry[]> {
	const byPath = new Map<string, string>();
	for (const entry of [...version.files, ...version.docs]) {
		if (!isTemporaryFile(entry.path)) byPath.set(entry.path, entry.hash);
	}
	const paths = [...byPath.keys()].sort((a, b) => a.localeCompare(b));
	return Promise.all(
		paths.map(async (path) => {
			const content = new Uint8Array(await read(byPath.get(path) ?? ''));
			return {
				path: path.replace(/^\/+/, ''),
				data: isBinaryFile(path) ? content : cleanBytes(content),
				isDirectory: false,
			};
		}),
	);
}

const plain = (text: string) =>
	text
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '');

const pad = (value: number) => String(value).padStart(2, '0');

/** The archive's name: the project's, then the version's label or time. */
export function versionArchiveName(
	projectName: string,
	time: number,
	label?: string,
): string {
	const date = new Date(time);
	const when = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
	const suffix = (label && plain(label)) || when;
	return `${plain(projectName) || 'projet'}-${suffix}.zip`;
}
