import {
	chosenFolderTree,
	droppedEntries,
	holdsFolder,
	pathInProject,
	readDroppedTree,
} from '@src/utils/folderUpload';

// File system entries as a browser gives them for a drop, read in batches.
type Fake = { name: string; children?: Fake[]; text?: string };

function entryOf(fake: Fake, batch = 2): FileSystemEntry {
	if (fake.children) {
		return {
			name: fake.name,
			isFile: false,
			isDirectory: true,
			createReader: () => {
				let at = 0;
				return {
					readEntries: (done: (entries: FileSystemEntry[]) => void) => {
						const next = fake.children!.slice(at, at + batch);
						at += batch;
						setTimeout(() => done(next.map((child) => entryOf(child, batch))));
					},
				};
			},
		} as unknown as FileSystemEntry;
	}
	return {
		name: fake.name,
		isFile: true,
		isDirectory: false,
		file: (done: (file: File) => void) =>
			done(new File([fake.text ?? fake.name], fake.name)),
	} as unknown as FileSystemEntry;
}

const these: Fake = {
	name: 'these',
	children: [
		{ name: 'main.tex', text: '\\documentclass{article}' },
		{ name: '.git', children: [{ name: 'HEAD' }] },
		{ name: '.DS_Store' },
		{ name: '._main.tex' },
		{
			name: 'figures',
			children: [
				{ name: 'c.png' },
				{ name: 'a.png' },
				{ name: 'b.png' },
				{ name: 'anciennes', children: [{ name: 'vieux.pdf' }] },
			],
		},
		{ name: 'vide', children: [] },
	],
};

describe('folders dropped on the file tree', () => {
	it('arrive with their subfolders, read to the last batch', async () => {
		const tree = await readDroppedTree([entryOf(these)]);
		expect(tree.directories).toEqual([
			'these',
			'these/figures',
			'these/figures/anciennes',
			'these/vide',
		]);
		expect(tree.files.map((entry) => entry.path)).toEqual([
			'these/figures/a.png',
			'these/figures/anciennes/vieux.pdf',
			'these/figures/b.png',
			'these/figures/c.png',
			'these/main.tex',
		]);
		const main = tree.files.find((entry) => entry.path === 'these/main.tex');
		// The file itself, as the browser read it (jsdom's File has no text()).
		expect(main?.file.name).toBe('main.tex');
		expect(main?.file.size).toBe('\\documentclass{article}'.length);
	});

	it('beside files dropped with them', async () => {
		const tree = await readDroppedTree([
			entryOf({ name: 'refs.bib' }),
			entryOf({ name: 'images', children: [{ name: 'x.png' }] }),
		]);
		expect(tree.files.map((entry) => entry.path)).toEqual([
			'refs.bib',
			'images/x.png',
		]);
		expect(tree.directories).toEqual(['images']);
	});

	it('are taken from the drop as entries, or not at all', () => {
		const folder = entryOf(these);
		const item = (entry: FileSystemEntry | null) =>
			({ kind: 'file', webkitGetAsEntry: () => entry }) as DataTransferItem;
		const drop = (items: DataTransferItem[]) =>
			({ items }) as unknown as DataTransfer;

		const entries = droppedEntries(
			drop([item(folder), { kind: 'string' } as DataTransferItem]),
		);
		expect(entries).toEqual([folder]);
		expect(holdsFolder(entries)).toBe(true);
		expect(holdsFolder(droppedEntries(drop([item(entryOf({ name: 'a.tex' }))])))).toBe(
			false,
		);
		// Without entries for every file, the files alone count.
		expect(droppedEntries(drop([item(folder), item(null)]))).toBeNull();
		expect(
			droppedEntries(drop([{ kind: 'file' } as DataTransferItem])),
		).toBeNull();
		expect(droppedEntries(drop([]))).toBeNull();
	});
});

describe('a folder chosen with « Téléverser un dossier »', () => {
	const chosen = (path: string) => {
		const file = new File(['x'], path.split('/').pop()!);
		Object.defineProperty(file, 'webkitRelativePath', { value: path });
		return file;
	};

	it('keeps each file under its folders, parents first', () => {
		const tree = chosenFolderTree([
			chosen('these/figures/anciennes/vieux.pdf'),
			chosen('these/main.tex'),
			chosen('these/.git/HEAD'),
			chosen('these/figures/.DS_Store'),
			chosen('these/figures/a.png'),
		]);
		expect(tree.directories).toEqual([
			'these',
			'these/figures',
			'these/figures/anciennes',
		]);
		expect(tree.files.map((entry) => entry.path)).toEqual([
			'these/figures/anciennes/vieux.pdf',
			'these/main.tex',
			'these/figures/a.png',
		]);
	});
});

it('places the upload in the folder it was dropped on', () => {
	expect(pathInProject('/', 'these/main.tex')).toBe('/these/main.tex');
	expect(pathInProject('/chapitres', 'figures/a.png')).toBe(
		'/chapitres/figures/a.png',
	);
});
