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
