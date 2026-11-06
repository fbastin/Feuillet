// src/utils/autoCompile.ts
// Overleaf's « Auto Compile »: the editor tells when the person changed the
// open document (not when a collaborator did); the compile button, when its
// auto compile is on, waits for a pause in the typing, has the open
// documents saved, as Ctrl+Enter does, then compiles.

const LOCAL_EDIT_EVENT = 'feuillet-local-edit';
const SAVE_OPEN_EVENT = 'feuillet-save-open-documents';

/** The pause after the last change, before compiling. */
export const AUTO_COMPILE_DELAY_MS = 2000;

/** The person changed the open document. */
export const announceLocalEdit = (): void => {
	document.dispatchEvent(new CustomEvent(LOCAL_EDIT_EVENT));
};

export const onLocalEdit = (listener: () => void): (() => void) => {
	document.addEventListener(LOCAL_EDIT_EVENT, listener);
	return () => document.removeEventListener(LOCAL_EDIT_EVENT, listener);
};

interface SaveRequest {
	saves: Promise<unknown>[];
}

/** Has every open editor save its document, and waits for them. */
export async function saveOpenDocuments(): Promise<void> {
	const detail: SaveRequest = { saves: [] };
	document.dispatchEvent(new CustomEvent(SAVE_OPEN_EVENT, { detail }));
	await Promise.allSettled(detail.saves);
}

/** An open editor's way of saving its document when asked. */
export const onSaveOpenDocuments = (
	save: () => Promise<unknown> | undefined,
): (() => void) => {
	const handler = (event: Event) => {
		const saving = save();
		if (saving) (event as CustomEvent<SaveRequest>).detail.saves.push(saving);
	};
	document.addEventListener(SAVE_OPEN_EVENT, handler);
	return () => document.removeEventListener(SAVE_OPEN_EVENT, handler);
};
