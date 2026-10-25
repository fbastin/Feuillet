import type { FileSyncInfo } from '@src/types/fileSync';
import {
	type FileManifestEntry,
	collabHttpBaseUrl,
	manifestEntryFor,
	planServerFileSync,
} from '@src/utils/serverFileSyncUtils';

const local = (overrides: Partial<FileSyncInfo>): FileSyncInfo => ({
	fileId: overrides.filePath ?? 'id',
	fileName: 'main.tex',
	filePath: '/main.tex',
	lastModified: 100,
	size: 4,
	checksum: 'aaa',
	userId: 'alice',
	username: 'alice',
	...overrides,
});

const entry = (overrides: Partial<FileManifestEntry>): FileManifestEntry => ({
	path: '/main.tex',
	checksum: 'aaa',
	size: 4,
	lastModified: 100,
	deleted: false,
	updatedBy: 'bob',
	...overrides,
});

const manifestOf = (...entries: FileManifestEntry[]) =>
	new Map(entries.map((item) => [item.path, item]));

describe('planServerFileSync', () => {
	it('publishes local files missing from the manifest', () => {
		const plan = planServerFileSync([local({})], manifestOf());
		expect(plan.publish.map((file) => file.filePath)).toEqual(['/main.tex']);
		expect(plan.apply).toEqual([]);
	});

	it('does not announce a local deletion nobody has seen', () => {
		const plan = planServerFileSync([local({ deleted: true })], manifestOf());
		expect(plan).toEqual({ publish: [], apply: [] });
	});

	it('downloads files that only exist in the manifest', () => {
		const remote = entry({ path: '/fig.png', checksum: 'bbb' });
		const plan = planServerFileSync([], manifestOf(remote));
		expect(plan.apply).toEqual([remote]);
	});

	it('keeps the newest version of a changed file', () => {
		const older = entry({ checksum: 'bbb', lastModified: 50 });
		expect(
			planServerFileSync([local({ lastModified: 100 })], manifestOf(older))
				.publish,
		).toHaveLength(1);

		const newer = entry({ checksum: 'bbb', lastModified: 200 });
		expect(
			planServerFileSync([local({ lastModified: 100 })], manifestOf(newer))
				.apply,
		).toEqual([newer]);
	});

	it('does nothing when both sides already agree', () => {
		const plan = planServerFileSync(
			[local({ lastModified: 100 }), local({ filePath: '/old.tex', deleted: true })],
			manifestOf(
				entry({ lastModified: 999 }),
				entry({ path: '/old.tex', deleted: true, checksum: '' }),
			),
		);
		expect(plan).toEqual({ publish: [], apply: [] });
	});

	it('propagates deletions in both directions', () => {
		const remoteDeletion = entry({ deleted: true, checksum: '', lastModified: 200 });
		expect(
			planServerFileSync([local({ lastModified: 100 })], manifestOf(remoteDeletion))
				.apply,
		).toEqual([remoteDeletion]);

		expect(
			planServerFileSync(
				[local({ deleted: true, lastModified: 300 })],
				manifestOf(entry({ lastModified: 100 })),
			).publish,
		).toHaveLength(1);
	});

	it('never overwrites a file linked to the same collaborative document', () => {
		const plan = planServerFileSync(
			[local({ documentId: 'doc-1', lastModified: 100 })],
			manifestOf(entry({ documentId: 'doc-1', checksum: 'bbb', lastModified: 200 })),
		);
		expect(plan).toEqual({ publish: [], apply: [] });
	});

	it('shares a newly linked file so collaborators get the link', () => {
		const plan = planServerFileSync(
			[local({ documentId: 'doc-1', lastModified: 200 })],
			manifestOf(entry({ lastModified: 100 })),
		);
		expect(plan.publish).toHaveLength(1);
	});
});

describe('manifest helpers', () => {
	it('turns a local file into a manifest entry', () => {
		expect(manifestEntryFor(local({ documentId: 'doc-1' }), 'alice')).toEqual({
			path: '/main.tex',
			checksum: 'aaa',
			size: 4,
			lastModified: 100,
			documentId: 'doc-1',
			deleted: false,
			updatedBy: 'alice',
		});
		expect(
			manifestEntryFor(local({ deleted: true }), 'alice'),
		).toEqual(expect.objectContaining({ deleted: true, checksum: '', size: 0 }));
	});

	it('derives the HTTP address from the WebSocket server', () => {
		expect(collabHttpBaseUrl('wss://feuillet.slashbin.net/collab/')).toBe(
			'https://feuillet.slashbin.net/collab',
		);
		expect(collabHttpBaseUrl('ws://localhost:1234')).toBe(
			'http://localhost:1234',
		);
	});
});
