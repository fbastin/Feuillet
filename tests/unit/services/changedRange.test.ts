jest.mock('y-indexeddb', () => ({ IndexeddbPersistence: jest.fn() }));
jest.mock('@src/services/OfflineService', () => ({
	offlineService: {
		addStatusListener: jest.fn(() => () => undefined),
		getStatus: () => ({ isOnline: true }),
	},
}));

import { changedRange } from '@src/services/CollabService';

const apply = (before: string, after: string) => {
	const { start, removed, inserted } = changedRange(before, after);
	return before.slice(0, start) + inserted + before.slice(start + removed);
};

describe('changedRange', () => {
	it('replaces only the part that differs', () => {
		expect(changedRange('Bonjour le monde', 'Bonjour tout le monde')).toEqual({
			start: 8,
			removed: 0,
			inserted: 'tout ',
		});
		expect(changedRange('abcdef', 'abXef')).toEqual({
			start: 2,
			removed: 2,
			inserted: 'X',
		});
	});

	it('changes nothing when the texts are the same', () => {
		expect(changedRange('même texte', 'même texte')).toEqual({
			start: 10,
			removed: 0,
			inserted: '',
		});
	});

	it('handles repeated characters at the edges', () => {
		for (const [before, after] of [
			['aaa', 'aaaa'],
			['aaaa', 'aa'],
			['', 'x'],
			['x', ''],
			['abab', 'ab'],
		]) {
			expect(apply(before, after)).toBe(after);
		}
	});

	it('never splits a character outside the basic plane', () => {
		for (const [before, after] of [
			['a😀b', 'a😃b'],
			['😀', '🨀'],
			['x😀', 'x😃'],
			['😀y', '😃y'],
		]) {
			const { start, removed, inserted } = changedRange(before, after);
			const kept = before.slice(0, start) + before.slice(start + removed);
			expect(apply(before, after)).toBe(after);
			expect(kept.isWellFormed?.() ?? true).toBe(true);
			expect(inserted.isWellFormed?.() ?? true).toBe(true);
		}
	});
});
