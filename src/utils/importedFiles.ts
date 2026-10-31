// src/utils/importedFiles.ts
// Files added from another project or from a URL keep their source, by path,
// to be refreshed later, as Overleaf's linked files.
import type { ImportedFile, ImportedFileSource } from '../types/documents';
import { isAtOrUnder, movedPath } from './fileEvents';

export type ImportedFiles = Record<string, ImportedFile>;

/** The entries once `from` has moved to `to`, with whatever was inside it. */
export function withMovedImportedFiles(
	files: ImportedFiles,
	from: string,
	to: string,
): ImportedFiles {
	const next: ImportedFiles = {};
	for (const [path, entry] of Object.entries(files)) {
		next[movedPath(path, from, to) ?? path] = entry;
	}
	return next;
}

/** The entries without those of the deleted files and folders. */
export function withoutImportedFiles(
	files: ImportedFiles,
	deleted: string[],
): ImportedFiles {
	return Object.fromEntries(
		Object.entries(files).filter(
			([path]) => !deleted.some((root) => isAtOrUnder(path, root)),
		),
	);
}

/** Where a file came from, as shown to people. */
export function describeImportedSource(source: ImportedFileSource): string {
	if (source.kind === 'project') {
		return `${source.projectName} (${source.path.replace(/^\//, '')})`;
	}
	try {
		const url = new URL(source.url);
		return `${url.host}${url.pathname}`;
	} catch {
		return source.url;
	}
}

export async function contentChecksum(
	content: ArrayBuffer | string,
): Promise<string> {
	const bytes =
		typeof content === 'string' ? new TextEncoder().encode(content) : content;
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}
