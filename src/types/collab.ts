// src/types/collab.ts
import type { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

import type { collabService } from '../services/CollabService';

export type CollabProviderType = 'webrtc' | 'websocket';

export interface CollabProvider {
	awareness: Awareness;
	connect(): void;
	disconnect(): void;
	destroy(): void;
	on(event: string, callback: (...args: any[]) => void): void;
	off?(event: string, callback: (...args: any[]) => void): void;
}

export interface CollabContextType<T = unknown> {
	collabService: typeof collabService;
	doc?: Y.Doc;
	provider?: CollabProvider;
	data: T | undefined;
	changeData: (fn: (data: T) => void) => void;
	isConnected: boolean;
	// Opened through a read-only or review link: changes to the project are
	// not offered, and the collaboration server would drop them anyway.
	readOnly: boolean;
	// Opened through a review link: documents change only by comments and
	// tracked changes, which the collaboration server checks, and the chat
	// is open.
	reviewOnly: boolean;
	getAwareness: (collectionName: string) => Awareness | null;
}

export interface DocContainer {
	doc: Y.Doc;
	persistence: IndexeddbPersistence;
	provider: CollabProvider;
	refCount: number;
}

export interface CollabConnectOptions {
	providerType?: CollabProviderType;
	signalingServers?: string | string[];
	websocketServer?: string;
	websocketParams?: Record<string, string>;
	autoReconnect?: boolean;
	awarenessTimeout?: number | false;
	password?: string;
}
