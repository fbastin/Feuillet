const closedHandlers: Array<(event: { code: number }) => void> = [];
const fakeProvider = () => ({
	on: jest.fn((event: string, handler: (event: { code: number }) => void) => {
		if (event === 'closed') closedHandlers.push(handler);
	}),
	awareness: { setLocalStateField: jest.fn(), on: jest.fn(), off: jest.fn() },
	disconnect: jest.fn(),
	connect: jest.fn(),
});

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
import { projectLinkService } from '@src/services/ProjectLinkService';

describe('CollabService and replaced editing links', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		closedHandlers.length = 0;
		collabService.setDefaultConnectOptions({
			providerType: 'websocket',
			websocketServer: 'wss://feuillet.example/collab',
		});
	});

	it('opens a project under the id the server knows it by', () => {
		projectLinkService.setServerId('moved', 'new-link');

		collabService.connect('moved', 'chat');

		expect(mockWebsocket.getProvider).toHaveBeenCalledWith(
			'new-link-chat',
			expect.anything(),
			expect.anything(),
		);
		collabService.disconnect('moved', 'chat');
		expect(mockWebsocket.releaseProvider).toHaveBeenCalledWith('new-link-chat');
	});

	it('moves open documents to the new link', () => {
		collabService.connect('open', 'yjs_metadata');
		collabService.connect('open', 'file_sync');
		collabService.connect('elsewhere', 'chat');

		projectLinkService.setServerId('open', 'replacement');

		expect(mockWebsocket.moveProvider).toHaveBeenCalledTimes(2);
		expect(mockWebsocket.moveProvider).toHaveBeenCalledWith(
			'open-yjs_metadata',
			'replacement-yjs_metadata',
		);
		expect(mockWebsocket.moveProvider).toHaveBeenCalledWith(
			'open-file_sync',
			'replacement-file_sync',
		);
		collabService.disconnect('open', 'file_sync');
		expect(mockWebsocket.releaseProvider).toHaveBeenCalledWith(
			'replacement-file_sync',
		);
	});

	it('reports a connection the server closed because its link was replaced', () => {
		const reported = jest
			.spyOn(projectLinkService, 'reportRefused')
			.mockImplementation(() => undefined);
		collabService.connect('cut', 'yjs_doc-1');

		closedHandlers[0]({ code: 1006 });
		expect(reported).not.toHaveBeenCalled();
		closedHandlers[0]({ code: 4403 });
		expect(reported).toHaveBeenCalledWith('cut', 'cut');
		reported.mockRestore();
	});
});
