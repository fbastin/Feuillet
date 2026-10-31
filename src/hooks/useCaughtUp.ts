// src/hooks/useCaughtUp.ts
import { useEffect, useState } from 'react';
import type { WebsocketProvider } from 'y-websocket';

import type { CollabProvider } from '../types/collab';

/**
 * Whether a shared document has caught up with the collaboration server, so
 * that a newer value there is not taken for a missing one. Offline or
 * between peers, the local copy is what there is.
 */
export function useCaughtUp(connection: CollabProvider | undefined): boolean {
	const [caughtUp, setCaughtUp] = useState(false);
	useEffect(() => {
		const websocket = connection as WebsocketProvider | undefined;
		if (!websocket || !('wsconnected' in websocket) || websocket.synced) {
			setCaughtUp(true);
			return;
		}
		setCaughtUp(false);
		const onSync = (synced: boolean) => {
			if (synced) setCaughtUp(true);
		};
		websocket.on('sync', onSync);
		return () => websocket.off('sync', onSync);
	}, [connection]);
	return caughtUp;
}
