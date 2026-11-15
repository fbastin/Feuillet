import * as Y from 'yjs';

import { toArrayBuffer } from './fileUtils';
import { toLineFeeds } from './lineEndings';

export const yjsStateFromText = (text: string): ArrayBuffer => {
	const doc = new Y.Doc();
	doc.getText('codemirror').insert(0, toLineFeeds(text));
	const state = Y.encodeStateAsUpdate(doc);
	doc.destroy();
	return toArrayBuffer(state);
};

export const textFromYjsState = (state: Uint8Array): string => {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, state);
	const text = doc.getText('codemirror').toString();
	doc.destroy();
	return text;
};
