import * as Y from 'yjs';

import { applySharedDataChange } from '@src/utils/sharedDataChange';

// Two people's copies of a project's shared data, from the same state. The
// tests' crypto gives every document the same client id: these get their
// own, which decide who wins a conflict.
const withClient = (clientID: number) => {
	const doc = new Y.Doc();
	doc.clientID = clientID;
	return doc;
};
const twoCopies = (firstId = 1, secondId = 2) => {
	const first = withClient(firstId);
	first.getMap('data').set('projectMetadata', { name: 'Thèse', description: '' });
	first.getMap('data').set('documents', [{ id: 'a', name: 'main.tex' }]);
	first.getMap('data').set('chatMessages', []);
	const second = withClient(secondId);
	Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
	return { first, second };
};
const exchange = (a: Y.Doc, b: Y.Doc) => {
	const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
	const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
	Y.applyUpdate(b, fromA);
	Y.applyUpdate(a, fromB);
};

describe('changing shared data', () => {
	it('applies the change', () => {
		const { first } = twoCopies();
		applySharedDataChange(first, (data) => {
			data.projectMetadata.name = 'Mémoire';
			data.currentDocId = 'a';
			delete data.chatMessages;
		});
		expect(first.getMap('data').toJSON()).toEqual({
			projectMetadata: { name: 'Mémoire', description: '' },
			documents: [{ id: 'a', name: 'main.tex' }],
			currentDocId: 'a',
		});
	});

	it('keeps both of two changes made at the same time to different things', () => {
		// Whichever copy wins a conflict, by its client id, each change stays.
		for (const [firstId, secondId] of [
			[1, 2],
			[2, 1],
		]) {
			const { first, second } = twoCopies(firstId, secondId);
			applySharedDataChange(first, (data) => {
				data.projectMetadata.name = 'Mémoire';
			});
			applySharedDataChange(second, (data) => {
				data.documents.push({ id: 'b', name: 'intro.tex' });
			});
			exchange(first, second);
			for (const copy of [first, second]) {
				expect(copy.getMap('data').toJSON()).toEqual({
					projectMetadata: { name: 'Mémoire', description: '' },
					documents: [
						{ id: 'a', name: 'main.tex' },
						{ id: 'b', name: 'intro.tex' },
					],
					chatMessages: [],
				});
			}
		}
	});

	it('writes nothing when nothing changes', () => {
		const { first } = twoCopies();
		const updates: Uint8Array[] = [];
		first.on('update', (update: Uint8Array) => updates.push(update));
		applySharedDataChange(first, () => {});
		expect(updates).toHaveLength(0);
	});
});
