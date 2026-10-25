// src/contexts/FileSyncContext.tsx
import type React from 'react';
import type { ReactNode } from 'react';

import { useSettings } from '../hooks/useSettings';
import type { YjsDocUrl } from '../types/yjs';
import { PeerFileSyncProvider } from './PeerFileSyncContext';
import { ServerFileSyncProvider } from './ServerFileSyncContext';

interface FileSyncProviderProps {
	children: ReactNode;
	docUrl: YjsDocUrl;
}

/**
 * Project files travel through the collaboration server in WebSocket mode
 * and peer to peer (FilePizza) in WebRTC mode.
 */
export const FileSyncProvider: React.FC<FileSyncProviderProps> = ({
	children,
	docUrl,
}) => {
	const { getSetting } = useSettings();
	const SyncProvider =
		getSetting('collab-provider-type')?.value === 'websocket'
			? ServerFileSyncProvider
			: PeerFileSyncProvider;
	return <SyncProvider docUrl={docUrl}>{children}</SyncProvider>;
};
