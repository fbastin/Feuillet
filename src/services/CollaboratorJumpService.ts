// src/services/CollaboratorJumpService.ts
// Going to where a collaborator is, as on Overleaf: clicking their avatar
// opens the document they have open (useEditorNavigation), then shows their
// cursor once that document's editor knows it (useEditorView).

export interface CollaboratorJump {
	userId?: string;
	username: string;
	/** The document they have open, when known. */
	documentId?: string;
	requestedAt: number;
}

type Listener = (jump: CollaboratorJump) => void;

// Long enough for a document to open and its people to arrive.
const PENDING_MS = 10000;

class CollaboratorJumpService {
	private jump: CollaboratorJump | null = null;
	private listeners = new Set<Listener>();

	request(target: Omit<CollaboratorJump, 'requestedAt'>): void {
		// The same one for every listener, though the first may finish it.
		const jump = { ...target, requestedAt: Date.now() };
		this.jump = jump;
		for (const listener of this.listeners) listener(jump);
	}

	/** The jump still to make in this document, if any. */
	pending(documentId: string | null | undefined): CollaboratorJump | null {
		const jump = this.jump;
		if (!jump || Date.now() - jump.requestedAt > PENDING_MS) return null;
		if (jump.documentId && jump.documentId !== documentId) return null;
		return jump;
	}

	done(jump: CollaboratorJump): void {
		if (this.jump === jump) this.jump = null;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Whether this awareness state is the person a jump is for. */
	matches(jump: CollaboratorJump, user: unknown): boolean {
		if (!user || typeof user !== 'object') return false;
		const { id, username } = user as { id?: unknown; username?: unknown };
		return jump.userId
			? id === jump.userId
			: typeof username === 'string' &&
					username.toLowerCase() === jump.username.toLowerCase();
	}
}

export const collaboratorJumpService = new CollaboratorJumpService();
