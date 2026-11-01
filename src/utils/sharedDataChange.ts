// src/utils/sharedDataChange.ts
import type * as Y from 'yjs';

// Applies a change to a shared document's data, writing only the keys it
// changed: two people changing different things at the same time (a
// project's details, its documents, the chat) then both keep theirs.
export const applySharedDataChange = (
	ydoc: Y.Doc,
	change: (data: any) => void,
): void => {
	const ymap = ydoc.getMap('data');
	ydoc.transact(() => {
		const before = ymap.toJSON();
		// A copy: toJSON hands out the stored values themselves, and a change
		// made to them in place would be seen here but never sent.
		const next = structuredClone(before);
		change(next);
		if (typeof next !== 'object' || next === null) return;

		for (const key of [...ymap.keys()]) {
			if (!(key in next)) ymap.delete(key);
		}
		for (const [key, value] of Object.entries(next)) {
			if (
				!(key in before) ||
				JSON.stringify(before[key]) !== JSON.stringify(value)
			) {
				ymap.set(key, value);
			}
		}
	});
};
