// src/utils/folderUpload.ts
// Folders from the computer, as on Overleaf: dropped on the file tree or
// chosen with « Téléverser un dossier », they arrive with their subfolders.
// Version-control folders and the system's own files stay behind: a .git
// from the computer would mix with the project's own Git history.

export interface UploadEntry {
	/** From the dropped or chosen folder's parent: figures/plot.png. */
	path: string;
	file: File;
}

export interface UploadTree {
	files: UploadEntry[];
	/** Every folder, parents first, the empty ones included: figures. */
	directories: string[];
}

const LEFT_OUT = new Set([
	'.git',
	'.svn',
	'.hg',
	'__MACOSX',
	'.DS_Store',
	'Thumbs.db',
	'desktop.ini',
]);

/** A name that stays on the computer; ._x are macOS's copies of attributes. */
export const isLeftOutOfUpload = (name: string): boolean =>
	LEFT_OUT.has(name) || name.startsWith('._');

/**
 * The dropped items as file system entries, taken while the drop event
 * lasts (the list empties after it, the entries stay readable). Null when
 * the browser gives no entries: the dropped files are then all there is.
 */
export function droppedEntries(
	dataTransfer: DataTransfer,
): FileSystemEntry[] | null {
	const items = Array.from(dataTransfer.items ?? []).filter(
		(item) => item.kind === 'file',
	);
	if (
		items.length === 0 ||
		items.some((item) => typeof item.webkitGetAsEntry !== 'function')
	) {
		return null;
	}
	const entries = items.flatMap((item) => {
		const entry = item.webkitGetAsEntry();
		return entry ? [entry] : [];
	});
	return entries.length === items.length ? entries : null;
}

export const holdsFolder = (entries: FileSystemEntry[] | null): boolean =>
	entries?.some((entry) => entry.isDirectory) ?? false;

// A directory is read in batches (100 at a time in Chrome) until one is empty.
const childrenOf = (
	directory: FileSystemDirectoryEntry,
): Promise<FileSystemEntry[]> => {
	const reader = directory.createReader();
	const children: FileSystemEntry[] = [];
	return new Promise((resolve, reject) => {
		const next = () =>
			reader.readEntries((batch) => {
				if (batch.length === 0) {
					resolve(children);
					return;
				}
				children.push(...batch);
				next();
			}, reject);
		next();
	});
};

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
	new Promise((resolve, reject) => entry.file(resolve, reject));

/** Everything the dropped entries hold, subfolders included. */
export async function readDroppedTree(
	entries: FileSystemEntry[],
): Promise<UploadTree> {
	const tree: UploadTree = { files: [], directories: [] };
	const visit = async (entry: FileSystemEntry, parent: string) => {
		if (isLeftOutOfUpload(entry.name)) return;
		const path = parent ? `${parent}/${entry.name}` : entry.name;
		if (entry.isDirectory) {
			tree.directories.push(path);
			const children = await childrenOf(entry as FileSystemDirectoryEntry);
			children.sort((a, b) => a.name.localeCompare(b.name));
			for (const child of children) await visit(child, path);
		} else if (entry.isFile) {
			tree.files.push({
				path,
				file: await fileOf(entry as FileSystemFileEntry),
			});
		}
	};
	for (const entry of entries) await visit(entry, '');
	return tree;
}

/**
 * A folder chosen with <input webkitdirectory>: each file knows its path
 * from the chosen folder's parent. Its empty subfolders are not given.
 */
export function chosenFolderTree(files: ArrayLike<File>): UploadTree {
	const tree: UploadTree = { files: [], directories: [] };
	const directories = new Set<string>();
	for (const file of Array.from(files)) {
		const path = file.webkitRelativePath || file.name;
		const parts = path.split('/').filter(Boolean);
		if (parts.some(isLeftOutOfUpload)) continue;
		for (let end = 1; end < parts.length; end++) {
			directories.add(parts.slice(0, end).join('/'));
		}
		tree.files.push({ path: parts.join('/'), file });
	}
	tree.directories = [...directories].sort(
		(a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
	);
	return tree;
}

/** The path in the project of a path from the upload. */
export const pathInProject = (folderPath: string, relative: string): string =>
	folderPath === '/' || folderPath === ''
		? `/${relative}`
		: `${folderPath.replace(/\/+$/, '')}/${relative}`;
