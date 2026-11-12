// A WebSocket whose `auth` names a registered function connects with the
// subprotocols it gives, as Feuillet's compile tickets (compileTicketAuth.ts).
import {
	TransportAuthError,
	registerTransportAuth,
	resolveTransportConfig,
} from '@chelys/peer/TransportResolution';

describe('Transport auth', () => {
	it('gives a WebSocket the subprotocols and end of its function', async () => {
		registerTransportAuth('test-ticket', async () => ({
			protocols: ['feuillet', 'feuillet-ticket.abc.def'],
			expiresAt: 1234,
		}));
		await expect(
			resolveTransportConfig('svc', {
				type: 'websocket',
				url: 'ws://test/',
				auth: 'test-ticket',
			}),
		).resolves.toEqual({
			type: 'websocket',
			url: 'ws://test/',
			auth: 'test-ticket',
			protocols: ['feuillet', 'feuillet-ticket.abc.def'],
			expiresAt: 1234,
		});
	});

	it('leaves a WebSocket without auth as it is', async () => {
		const config = { type: 'websocket' as const, url: 'ws://test/' };
		await expect(resolveTransportConfig('svc', config)).resolves.toBe(config);
	});

	it('connects without subprotocols when no function has that name', async () => {
		await expect(
			resolveTransportConfig('svc', {
				type: 'websocket',
				url: 'ws://test/',
				auth: 'nobody',
			}),
		).resolves.toMatchObject({ protocols: undefined, expiresAt: undefined });
	});

	it('passes on why a function will not let connect', async () => {
		registerTransportAuth('refusing', async () => {
			throw new TransportAuthError('An account is needed.');
		});
		await expect(
			resolveTransportConfig('svc', {
				type: 'websocket',
				url: 'ws://test/',
				auth: 'refusing',
			}),
		).rejects.toThrow(TransportAuthError);
	});
});
