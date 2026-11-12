// src/chelys/types/transport.ts
export type TransportType = 'websocket' | 'webrtc' | 'worker';

export type RemoteTransportType = Exclude<TransportType, 'worker'>;
export type ControlMode = 'account' | 'dedicated';

export interface TransportConfig {
	type: TransportType;
	url?: string;
	workerPath?: string;
	signaling?: string[];
	roomId?: string;
	controlRoomId?: string;
	controlMode?: ControlMode;
	contentLength?: boolean;
	/**
	 * For a WebSocket, the name of a function registered with
	 * registerTransportAuth (TransportResolution.ts), which gives the
	 * subprotocols to connect with, such as a ticket the server asks for.
	 */
	auth?: string;
	/** The subprotocols to connect with, as that function gave them. */
	protocols?: string[];
	/** When the server ends the connection, as that function said (ms). */
	expiresAt?: number;
}

export type TransportPayload = string | Uint8Array;

export type TransportStatus =
	| 'connected'
	| 'connecting'
	| 'disconnected'
	| 'error';

export interface ClientTransport {
	readonly isOpen: boolean;
	/** When the server ends it (its ticket's end, in ms), if it says. */
	readonly expiresAt?: number;
	send(payload: TransportPayload): void;
	abort?(): void;
	close(): void;
	onMessage(handler: (payload: TransportPayload) => void): () => void;
	onClose(handler: () => void): () => void;
	onError(handler: (error: Error) => void): () => void;
}

export interface HostTransport {
	readonly peerId: string;
	readonly isOpen: boolean;
	send(payload: TransportPayload): void;
	closeWhenDrained(): void;
	close(): void;
	onMessage(handler: (payload: TransportPayload) => void): () => void;
	onClose(handler: () => void): () => void;
}

export interface TransportOpenOptions {
	label: string;
	timeoutMs?: number;
}
