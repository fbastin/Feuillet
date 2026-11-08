import { createHash } from 'crypto';
import * as Y from 'yjs';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

const mockFileStore = {
	initialize: jest.fn(async () => undefined),
	getFile: jest.fn(),
	getFileByPath: jest.fn(async () => undefined as unknown),
	createDirectoryPath: jest.fn(async () => undefined),
	batchStoreFiles: jest.fn(async () => []),
	deleteFileByPath: jest.fn(async () => undefined),
};
const mockPeerFileSync = {
	getLocalFileSyncInfo: jest.fn(),
	calculateFileChecksum: jest.fn(async (content: ArrayBuffer) =>
		sha(new Uint8Array(content)),
	),
};

jest.mock('@src/services/FileStoreService', () => ({
	fileStoreService: mockFileStore,
}));
jest.mock('@src/services/PeerFileSyncService', () => ({
	peerFileSyncService: mockPeerFileSync,
}));

import {
	FILE_MANIFEST_KEY,
	serverFileSyncService,
} from '@src/services/ServerFileSyncService';

const server = new Map<string, Uint8Array>();
const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
	const key = url.replace('https://collab.test/files/', '');
	const method = init?.method ?? 'GET';
	if (method === 'PUT') {
		server.set(key, new Uint8Array(init?.body as ArrayBuffer));
		return { ok: true, status: 201 };
	}
	const stored = server.get(key);
	if (!stored) return { ok: false, status: 404 };
	return {
		ok: true,
		status: 200,
		arrayBuffer: async () => stored.slice().buffer,
	};
});

const user = { id: 'alice-id', username: 'alice' } as never;
const options = (doc: Y.Doc) => ({
	doc,
	projectId: 'project-1',
	docUrl: 'yjs:project-1',
	baseUrl: 'https://collab.test',
	user,
});

describe('ServerFileSyncService', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		server.clear();
		global.fetch = fetchMock as never;
	});

	it('uploads a new local file and lists it in the shared manifest', async () => {
		const content = bytes('\\documentclass{article}');
		mockPeerFileSync.getLocalFileSyncInfo.mockResolvedValue([
			{
				fileId: 'f1',
				fileName: 'main.tex',
				filePath: '/main.tex',
				lastModified: 100,
				size: content.byteLength,
				checksum: sha(content),
				userId: 'alice-id',
				username: 'alice',
			},
		]);
		mockFileStore.getFile.mockResolvedValue({ content: content.slice().buffer });
		const doc = new Y.Doc();

		const result = await serverFileSyncService.synchronize(options(doc));

		expect(result).toEqual({ published: 1, applied: 0, failures: [] });
		expect(server.get(`project-1/${sha(content)}`)).toEqual(content);
		expect(doc.getMap(FILE_MANIFEST_KEY).get('/main.tex')).toEqual(
			expect.objectContaining({ checksum: sha(content), updatedBy: 'alice' }),
		);
	});

	it('never shares local files through a read-only link', async () => {
		const content = bytes('\\documentclass{article}');
		mockPeerFileSync.getLocalFileSyncInfo.mockResolvedValue([
			{
				fileId: 'f1',
				fileName: 'main.tex',
				filePath: '/main.tex',
				lastModified: 100,
				size: content.byteLength,
				checksum: sha(content),
				userId: 'alice-id',
				username: 'alice',
			},
		]);
		mockFileStore.getFile.mockResolvedValue({ content: content.slice().buffer });
		const doc = new Y.Doc();
		const view = `view${'a'.repeat(32)}`;

		const result = await serverFileSyncService.synchronize({
			...options(doc),
			projectId: view,
			docUrl: `yjs:${view}`,
		});

		expect(result).toEqual({ published: 0, applied: 0, failures: [] });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(doc.getMap(FILE_MANIFEST_KEY).size).toBe(0);
	});

	it('downloads files listed by collaborators and keeps their metadata', async () => {
		const content = bytes('figure');
		server.set(`project-1/${sha(content)}`, content);
		mockPeerFileSync.getLocalFileSyncInfo.mockResolvedValue([]);
		const doc = new Y.Doc();
		doc.getMap(FILE_MANIFEST_KEY).set('/figures/plot.png', {
			path: '/figures/plot.png',
			checksum: sha(content),
			size: content.byteLength,
			lastModified: 42,
			documentId: 'doc-7',
			deleted: false,
			updatedBy: 'bob',
		});

		const result = await serverFileSyncService.synchronize(options(doc));

		expect(result).toEqual({ published: 0, applied: 1, failures: [] });
		expect(mockFileStore.createDirectoryPath).toHaveBeenCalledWith(
			'/figures/plot.png',
		);
		const [stored, storeOptions] = mockFileStore.batchStoreFiles.mock.calls[0] as unknown as [
			Array<Record<string, unknown>>,
			Record<string, unknown>,
		];
		expect(stored[0]).toEqual(
			expect.objectContaining({
				path: '/figures/plot.png',
				name: 'plot.png',
				lastModified: 42,
				documentId: 'doc-7',
				isBinary: true,
			}),
		);
		expect(storeOptions).toEqual(
			expect.objectContaining({ preserveTimestamp: true }),
		);
	});

	it('receives many files a few at a time, stored batch by batch', async () => {
		mockPeerFileSync.getLocalFileSyncInfo.mockResolvedValue([]);
		const doc = new Y.Doc();
		for (let index = 0; index < 65; index++) {
			const content = bytes(`section ${index}`);
			server.set(`project-1/${sha(content)}`, content);
			doc.getMap(FILE_MANIFEST_KEY).set(`/parties/s${index}.tex`, {
				path: `/parties/s${index}.tex`,
				checksum: sha(content),
				size: content.byteLength,
				lastModified: index,
				deleted: false,
				updatedBy: 'bob',
			});
		}
		let running = 0;
		let most = 0;
		global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
			running++;
			most = Math.max(most, running);
			await new Promise((resolve) => setTimeout(resolve, 2));
			running--;
			return fetchMock(url, init);
		}) as never;

		const result = await serverFileSyncService.synchronize(options(doc));

		expect(result).toEqual({ published: 0, applied: 65, failures: [] });
		expect(most).toBeGreaterThan(1);
		expect(most).toBeLessThanOrEqual(6);
		const sizes = mockFileStore.batchStoreFiles.mock.calls.map(
			(call) => (call as unknown as [unknown[]])[0].length,
		);
		expect(sizes).toEqual([30, 30, 5]);
	});

	it('sends many files a few at a time, listing each batch once it is on the server', async () => {
		const local = Array.from({ length: 35 }, (_, index) => {
			const content = bytes(`texte ${index}`);
			return {
				content,
				info: {
					fileId: `f${index}`,
					fileName: `t${index}.tex`,
					filePath: `/t${index}.tex`,
					lastModified: 100 + index,
					size: content.byteLength,
					checksum: sha(content),
					userId: 'alice-id',
					username: 'alice',
				},
			};
		});
		mockPeerFileSync.getLocalFileSyncInfo.mockResolvedValue(
			local.map((file) => file.info),
		);
		mockFileStore.getFile.mockImplementation(async (id: string) => ({
			content: local.find((file) => file.info.fileId === id)?.content.slice()
				.buffer,
		}));
		const doc = new Y.Doc();
		const listed: number[] = [];
		doc
			.getMap(FILE_MANIFEST_KEY)
			.observe(() => listed.push(doc.getMap(FILE_MANIFEST_KEY).size));

		const result = await serverFileSyncService.synchronize(options(doc));

		expect(result.published).toBe(35);
		expect(listed).toEqual([30, 35]);
		expect(server.size).toBe(35);
	});

	it('stores the files linked to documents before the others', async () => {
		const image = bytes('image');
		const tex = bytes('\\documentclass{article}');
		server.set(`project-1/${sha(image)}`, image);
		server.set(`project-1/${sha(tex)}`, tex);
		mockPeerFileSync.getLocalFileSyncInfo.mockResolvedValue([]);
		const doc = new Y.Doc();
		const manifest = doc.getMap(FILE_MANIFEST_KEY);
		manifest.set('/a.png', {
			path: '/a.png',
			checksum: sha(image),
			size: image.byteLength,
			lastModified: 1,
			deleted: false,
			updatedBy: 'bob',
		});
		manifest.set('/main.tex', {
			path: '/main.tex',
			checksum: sha(tex),
			size: tex.byteLength,
			lastModified: 1,
			documentId: 'doc-1',
			deleted: false,
			updatedBy: 'bob',
		});

		const result = await serverFileSyncService.synchronize(options(doc));

		expect(result.applied).toBe(2);
		const batches = mockFileStore.batchStoreFiles.mock.calls.map((call) =>
			((call as unknown as [Array<{ path: string }>])[0]).map((file) => file.path),
		);
		expect(batches).toEqual([['/main.tex'], ['/a.png']]);
	});

	it('rejects a download whose content does not match its checksum', async () => {
		server.set(`project-1/${sha(bytes('expected'))}`, bytes('tampered'));
		mockPeerFileSync.getLocalFileSyncInfo.mockResolvedValue([]);
		const doc = new Y.Doc();
		doc.getMap(FILE_MANIFEST_KEY).set('/main.tex', {
			path: '/main.tex',
			checksum: sha(bytes('expected')),
			size: 8,
			lastModified: 1,
			deleted: false,
			updatedBy: 'bob',
		});

		const result = await serverFileSyncService.synchronize(options(doc));

		expect(result.applied).toBe(0);
		expect(result.failures).toHaveLength(1);
		expect(mockFileStore.batchStoreFiles).not.toHaveBeenCalled();
	});

	it('applies a collaborator deletion to the local file', async () => {
		const content = bytes('old');
		mockPeerFileSync.getLocalFileSyncInfo.mockResolvedValue([
			{
				fileId: 'f2',
				fileName: 'old.tex',
				filePath: '/old.tex',
				lastModified: 10,
				size: 3,
				checksum: sha(content),
				userId: 'alice-id',
				username: 'alice',
			},
		]);
		const doc = new Y.Doc();
		doc.getMap(FILE_MANIFEST_KEY).set('/old.tex', {
			path: '/old.tex',
			checksum: '',
			size: 0,
			lastModified: 20,
			deleted: true,
			updatedBy: 'bob',
		});

		const result = await serverFileSyncService.synchronize(options(doc));

		expect(result.applied).toBe(1);
		expect(mockFileStore.deleteFileByPath).toHaveBeenCalledWith('/old.tex', {
			showDeleteDialog: false,
			hardDelete: false,
			allowLinkedFileDelete: true,
		});
	});
});
