const providers: Array<{
	synced: boolean;
	wsconnected: boolean;
	handlers: Map<string, (value: boolean) => void>;
}> = [];
const fakeProvider = () => {
	const handlers = new Map<string, (value: boolean) => void>();
	const provider = {
		synced: false,
		wsconnected: true,
		handlers,
		on: jest.fn((event: string, handler: (value: boolean) => void) => {
			handlers.set(event, handler);
		}),
		off: jest.fn((event: string) => handlers.delete(event)),
		awareness: { setLocalStateField: jest.fn(), on: jest.fn(), off: jest.fn() },
		disconnect: jest.fn(),
		connect: jest.fn(),
	};
	providers.push(provider);
	return provider;
};

const mockWebsocket = {
	getProvider: jest.fn(fakeProvider),
	moveProvider: jest.fn(),
	releaseProvider: jest.fn(),
};

jest.mock('y-indexeddb', () => ({
	IndexeddbPersistence: jest.fn().mockImplementation(() => ({
		on: jest.fn(),
		once: jest.fn(),
		destroy: jest.fn(),
		synced: true,
	})),
}));
jest.mock('@src/extensions/yjs/CollabWebsocket', () => ({
	collabWebsocket: mockWebsocket,
}));
jest.mock('@src/extensions/yjs/CollabWebrtc', () => ({
	collabWebrtc: { getProvider: jest.fn(fakeProvider), releaseProvider: jest.fn() },
}));
jest.mock('@src/services/OfflineService', () => ({
	offlineService: {
		addStatusListener: jest.fn(() => () => undefined),
		getStatus: () => ({ isOnline: true }),
	},
}));

import { collabService } from '@src/services/CollabService';

describe('CollabService.openDocumentsUpToDate', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		providers.length = 0;
		collabService.setDefaultConnectOptions({
			providerType: 'websocket',
			websocketServer: 'wss://feuillet.example/collab',
		});
	});

	it('waits until every document has caught up with the server', async () => {
		let done = false;
		const opening = collabService
			.openDocumentsUpToDate('p1', ['a', 'b'])
			.then((release) => {
				done = true;
				return release;
			});
		await Promise.resolve();
		expect(providers).toHaveLength(2);
		providers[0].handlers.get('sync')?.(true);
		await Promise.resolve();
		expect(done).toBe(false);
		providers[1].handlers.get('sync')?.(true);
		const release = await opening;
		expect(collabService.getDocContainer('p1', 'yjs_a')).toBeDefined();

		release();
		expect(collabService.getDocContainer('p1', 'yjs_a')).toBeUndefined();
		expect(collabService.getDocContainer('p1', 'yjs_b')).toBeUndefined();
	});

	it('does not wait for documents already up to date', async () => {
		mockWebsocket.getProvider.mockImplementationOnce(() => {
			const provider = fakeProvider();
			provider.synced = true;
			return provider;
		});
		const release = await collabService.openDocumentsUpToDate('p2', ['c']);
		release();
	});

	it('fails, closing what it opened, when the server does not answer', async () => {
		await expect(
			collabService.openDocumentsUpToDate('p3', ['d'], 20),
		).rejects.toThrow();
		expect(collabService.getDocContainer('p3', 'yjs_d')).toBeUndefined();
	});
});
