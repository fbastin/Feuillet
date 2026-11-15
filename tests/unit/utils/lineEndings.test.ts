import * as Y from 'yjs';

import {
	keepLineFeeds,
	normalizeLineEndings,
	toLineFeeds,
} from '@/utils/lineEndings';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('line endings of shared texts', () => {
	it('writes \\r\\n and a lone \\r as \\n', () => {
		expect(toLineFeeds('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
		expect(toLineFeeds('plain\n')).toBe('plain\n');
	});

	it('takes the \\r out of a shared text, the rest kept', () => {
		const doc = new Y.Doc();
		const text = doc.getText('codemirror');
		text.insert(0, '@misc{a,\r\n  title = {One},\r\n}\r\rlast');
		expect(normalizeLineEndings(text)).toBe(true);
		expect(text.toString()).toBe('@misc{a,\n  title = {One},\n}\n\nlast');
		expect(normalizeLineEndings(text)).toBe(false);
	});

	it('keeps it so when a \\r comes, from another client too', async () => {
		const doc = new Y.Doc();
		const text = doc.getText('codemirror');
		text.insert(0, 'one\r\ntwo\r\n');
		const stop = keepLineFeeds(text);
		expect(text.toString()).toBe('one\ntwo\n');

		// Another client writes CRLF.
		const other = new Y.Doc();
		Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
		other.getText('codemirror').insert(4, 'pasted\r\n');
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
		expect(text.toString()).toBe('one\npasted\r\ntwo\n');
		await flush();
		expect(text.toString()).toBe('one\npasted\ntwo\n');

		stop();
		text.insert(0, 'x\r\n');
		await flush();
		expect(text.toString()).toBe('x\r\none\npasted\ntwo\n');
	});

	it('is no step to undo', async () => {
		const doc = new Y.Doc();
		const text = doc.getText('codemirror');
		const undo = new Y.UndoManager(text);
		text.insert(0, 'a\r\nb');
		undo.stopCapturing();
		const stop = keepLineFeeds(text);
		await flush();
		expect(text.toString()).toBe('a\nb');
		// Undoing takes back the typing, not the line endings.
		undo.undo();
		expect(text.toString()).toBe('');
		stop();
	});
});
