// src/services/compileTicketAuth.ts
// The tickets that Feuillet's TeX Live server asks of each connection, as
// Overleaf compiles only for accounts (server/collab/compileTickets.js): the
// signed-in account's, or else one by the link of the project open, when an
// account owns it. They go in the WebSocket's subprotocols, the only header
// a browser lets a page set.
import {
	TransportAuthError,
	registerTransportAuth,
} from '@chelys/peer/TransportResolution';
import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { COMPILE_TICKET_AUTH } from '../utils/texliveTypesetter';
import { parseUrlFragments } from '../utils/urlUtils';
import { AccountServerError, accountSyncService } from './AccountSyncService';

const moduleLog = createNamedLogger('compileTicketAuth');

// The id of the project open, as its link gives it.
const openProject = (): string | undefined => {
	const { yjsUrl } = parseUrlFragments(window.location.hash.slice(1));
	return yjsUrl ? yjsUrl.slice('yjs:'.length) : undefined;
};

registerTransportAuth(COMPILE_TICKET_AUTH, async () => {
	try {
		const ticket = await accountSyncService.compileTicket(openProject());
		return ticket
			? {
					protocols: ['feuillet', `feuillet-ticket.${ticket.ticket}`],
					expiresAt: ticket.expiresAt,
				}
			: {};
	} catch (error) {
		if (
			error instanceof AccountServerError &&
			error.code === 'account_required'
		) {
			throw new TransportAuthError(
				t(
					'Compiling on the server needs an account: sign in, or create one. A project an account shares with you by its link compiles without one; a compiler that runs in the browser, chosen in the project settings, too.',
				),
			);
		}
		// Without one, the TeX Live server tells whether it needs one.
		moduleLog.warn('No compile ticket:', error);
		return {};
	}
});
