// src/utils/fileEvents.ts
// Events sent on the document when someone moves or deletes files of the
// open project, for what is kept by path: the main document, imported files.

/** A file or folder of the project moved from one path to another. */
export const FILE_MOVED_EVENT = 'file-moved';

export interface FileMovedDetail {
	from: string;
	to: string;
}

/** Files or folders of the project were deleted. */
export const FILE_DELETED_EVENT = 'files-deleted';

export interface FileDeletedDetail {
	paths: string[];
}

/** Whether `path` is `root` or inside the folder `root`. */
export const isAtOrUnder = (path: string, root: string): boolean =>
	path === root || path.startsWith(`${root}/`);

/** Where a path is once `from` has moved to `to`, if it moved with it. */
export function movedPath(
	path: string | undefined,
	from: string,
	to: string,
): string | undefined {
	if (!path || !isAtOrUnder(path, from)) return undefined;
	return `${to}${path.slice(from.length)}`;
}
