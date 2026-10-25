const fakeProvider = () => ({
	on: jest.fn(),
	awareness: { setLocalStateField: jest.fn(), on: jest.fn(), off: jest.fn() },
	disconnect: jest.fn(),
	connect: jest.fn(),
});

const mockWebsocket = { getProvider: jest.fn(fakeProvider), releaseProvider: jest.fn() };
const mockWebrtc = { getProvider: jest.fn(fakeProvider), releaseProvider: jest.fn() };

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
	collabWebrtc: mockWebrtc,
}));
jest.mock('@src/services/OfflineService', () => ({
	offlineService: {
		addStatusListener: jest.fn(() => () => undefined),
		getStatus: () => ({ isOnline: true }),
	},
}));

import { collabService } from '@src/services/CollabService';

describe('CollabService default connection options', () => {
	beforeEach(() => jest.clearAllMocks());

	it('uses the configured WebSocket server for callers that set no provider', () => {
		collabService.setDefaultConnectOptions({
			providerType: 'websocket',
			websocketServer: 'wss://feuillet.example/collab',
			signalingServers: ['wss://signal.example'],
		});

		collabService.connect('project-1', 'chat', {
			signalingServers: ['wss://ignored-for-websocket.example'],
			autoReconnect: undefined,
		});

		expect(mockWebrtc.getProvider).not.toHaveBeenCalled();
		expect(mockWebsocket.getProvider).toHaveBeenCalledWith(
			'project-1-chat',
			expect.anything(),
			{ serverUrl: 'wss://feuillet.example/collab', params: undefined },
		);
	});

	it('lets an explicit caller choice win over the defaults', () => {
		collabService.setDefaultConnectOptions({
			providerType: 'websocket',
			websocketServer: 'wss://feuillet.example/collab',
		});

		collabService.connect('project-2', 'yjs_metadata', {
			providerType: 'webrtc',
			signalingServers: ['wss://signal.example'],
		});

		expect(mockWebsocket.getProvider).not.toHaveBeenCalled();
		expect(mockWebrtc.getProvider).toHaveBeenCalledWith(
			'project-2-yjs_metadata',
			expect.anything(),
			expect.objectContaining({ signaling: ['wss://signal.example'] }),
		);
	});
});
