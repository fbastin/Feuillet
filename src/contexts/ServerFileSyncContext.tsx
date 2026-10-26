// src/contexts/ServerFileSyncContext.tsx
import { nanoid } from 'nanoid';
import type React from 'react';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import type * as Y from 'yjs';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { useAuth } from '../hooks/useAuth';
import { useFileTree } from '../hooks/useFileTree';
import { useSettings } from '../hooks/useSettings';
import { collabService } from '../services/CollabService';
import { fileStorageEventEmitter } from '../services/FileStoreService';
import { normalizeNotificationMode } from '../services/NotificationService';
import { peerFileSyncService } from '../services/PeerFileSyncService';
import {
	FILE_MANIFEST_KEY,
	LOCAL_MANIFEST_ORIGIN,
	serverFileSyncService,
} from '../services/ServerFileSyncService';
import type { CollabProvider } from '../types/collab';
import type { FileSyncNotification } from '../types/fileSync';
import type { YjsDocUrl } from '../types/yjs';
import { collabHttpBaseUrl } from '../utils/serverFileSyncUtils';
import { PeerFileSyncContext } from './PeerFileSyncContext';

const moduleLog = createNamedLogger('ServerFileSyncContext');

const SYNC_DEBOUNCE_MS = 800;

const waitForServerSync = (
	provider: CollabProvider & { synced?: boolean },
): Promise<void> =>
	new Promise((resolve) => {
		if (provider.synced) {
			resolve();
			return;
		}
		const onSync = (isSynced: boolean) => {
			if (!isSynced) return;
			provider.off?.('sync', onSync);
			resolve();
		};
		provider.on('sync', onSync);
	});

interface ServerFileSyncProviderProps {
	children: ReactNode;
	docUrl: YjsDocUrl;
}

/**
 * File sync for the WebSocket collaboration mode: files go through the
 * collaboration server instead of peer-to-peer transfers, so collaborators
 * receive them even when the author is offline.
 */
export const ServerFileSyncProvider: React.FC<ServerFileSyncProviderProps> = ({
	children,
	docUrl,
}) => {
	const { user } = useAuth();
	const { getSetting } = useSettings();
	const { refreshFileTree } = useFileTree();

	const [isSyncing, setIsSyncing] = useState(false);
	const [lastSync, setLastSync] = useState<number | null>(null);
	// The project whose files this device has received at least once.
	const [receivedProjectId, setReceivedProjectId] = useState<string | null>(
		null,
	);
	const [notifications, setNotifications] = useState<FileSyncNotification[]>(
		[],
	);

	const isEnabled = (getSetting('file-sync-enable')?.value as boolean) ?? false;
	const intervalSeconds =
		(getSetting('file-sync-auto-interval')?.value as number) ?? 10;
	const websocketServer =
		(getSetting('collab-websocket-server')?.value as string | undefined) ?? '';
	const notificationMode = normalizeNotificationMode(
		getSetting('file-sync-notifications')?.value,
	);
	const projectId = docUrl.startsWith('yjs:') ? docUrl.slice(4) : docUrl;

	const docRef = useRef<Y.Doc | null>(null);
	const readyRef = useRef(false);
	const runningRef = useRef(false);
	const pendingRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const addNotification = useCallback(
		(notification: Omit<FileSyncNotification, 'id' | 'timestamp'>) => {
			if (
				notificationMode === 'off' ||
				(notificationMode === 'errors' && notification.type !== 'sync_error')
			)
				return;
			setNotifications((current) => [
				...current,
				{ id: nanoid(), timestamp: Date.now(), ...notification },
			]);
		},
		[notificationMode],
	);

	const runSync = useCallback(async () => {
		const doc = docRef.current;
		if (!doc || !readyRef.current || !user || !isEnabled) return;
		if (runningRef.current) {
			pendingRef.current = true;
			return;
		}

		runningRef.current = true;
		setIsSyncing(true);
		try {
			const result = await serverFileSyncService.synchronize({
				doc,
				projectId,
				docUrl,
				baseUrl: collabHttpBaseUrl(websocketServer),
				user,
			});
			if (result.applied > 0) {
				await refreshFileTree();
				peerFileSyncService.showSuccessNotification(
					t('Received {count} file updates from collaborators', {
						count: result.applied,
					}),
					{ duration: 2500 },
				);
			}
			for (const failure of result.failures) {
				peerFileSyncService.showErrorNotification(failure, { duration: 6000 });
				addNotification({ type: 'sync_error', message: failure });
			}
			setLastSync(Date.now());
			setReceivedProjectId(projectId);
		} catch (error) {
			moduleLog.error('File sync through the server failed:', error);
			addNotification({
				type: 'sync_error',
				message: t('File sync failed: {message}', {
					message: error instanceof Error ? error.message : String(error),
				}),
			});
		} finally {
			runningRef.current = false;
			setIsSyncing(false);
		}

		if (pendingRef.current) {
			pendingRef.current = false;
			void runSync();
		}
	}, [
		addNotification,
		docUrl,
		isEnabled,
		projectId,
		refreshFileTree,
		user,
		websocketServer,
	]);

	const runSyncRef = useRef(runSync);
	runSyncRef.current = runSync;

	const scheduleSync = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			void runSyncRef.current();
		}, SYNC_DEBOUNCE_MS);
	}, []);

	useEffect(() => {
		if (!user || !projectId) return;

		const { doc, provider } = collabService.connect(projectId, 'file_sync');
		collabService.setUserInfo(projectId, 'file_sync', user);
		docRef.current = doc;
		readyRef.current = false;

		const manifest = doc.getMap(FILE_MANIFEST_KEY);
		const onManifestChange = (_event: unknown, transaction: Y.Transaction) => {
			if (transaction.origin !== LOCAL_MANIFEST_ORIGIN) scheduleSync();
		};
		manifest.observe(onManifestChange);

		let active = true;
		// Publishing before the manifest arrived would re-announce every local
		// file as new, so wait for the first sync with the server. Offline
		// projects (no provider) have no server to sync with.
		if (provider) {
			void waitForServerSync(provider).then(() => {
				if (!active) return;
				readyRef.current = true;
				scheduleSync();
			});
		} else {
			setReceivedProjectId(projectId);
		}

		return () => {
			active = false;
			manifest.unobserve(onManifestChange);
			readyRef.current = false;
			docRef.current = null;
			if (timerRef.current) clearTimeout(timerRef.current);
			collabService.disconnect(projectId, 'file_sync');
		};
	}, [projectId, scheduleSync, user]);

	useEffect(() => {
		if (!isEnabled) return;
		const unsubscribe = fileStorageEventEmitter.onChange(scheduleSync);
		const interval = setInterval(scheduleSync, intervalSeconds * 1000);
		scheduleSync();
		return () => {
			unsubscribe();
			clearInterval(interval);
		};
	}, [intervalSeconds, isEnabled, scheduleSync]);

	const requestSync = useCallback(async () => {
		await runSyncRef.current();
	}, []);

	return (
		<PeerFileSyncContext.Provider
			value={{
				isEnabled,
				isSyncing,
				lastSync,
				filesReceived: !isEnabled || receivedProjectId === projectId,
				notifications,
				enableSync: scheduleSync,
				disableSync: () => {},
				requestSync,
				clearNotification: (id: string) =>
					setNotifications((current) => current.filter((n) => n.id !== id)),
				clearAllNotifications: () => setNotifications([]),
				cleanupStaleFileReferences: async () => {},
			}}
		>
			{children}
		</PeerFileSyncContext.Provider>
	);
};
