import type { ProjectMetadata } from '@src/types/documents';
import {
	isTracked,
	isUserTracked,
	withEveryoneTracked,
	withLegacyTracking,
	withUserTracked,
} from '@src/utils/trackChangesUtils';

const metadata: ProjectMetadata = { name: 'Thèse', description: '' };

describe('whose changes are tracked, in the whole project', () => {
	it('tracks everyone, or the accounts chosen, whatever their case', () => {
		const alice = withUserTracked(metadata, 'Alice', true);
		expect(alice.trackChanges).toEqual({ users: ['Alice'] });
		expect(isTracked(alice.trackChanges, 'alice')).toBe(true);
		expect(isTracked(alice.trackChanges, 'bob')).toBe(false);
		expect(isTracked(alice.trackChanges, undefined)).toBe(false);

		const everyone = withEveryoneTracked(alice, true);
		expect(isTracked(everyone.trackChanges, 'bob')).toBe(true);
		expect(isUserTracked(everyone.trackChanges, 'bob')).toBe(false);
		expect(withEveryoneTracked(everyone, false).trackChanges).toEqual({
			users: ['Alice'],
		});
	});

	it('keeps an account once, and forgets the setting when nobody is left', () => {
		const twice = withUserTracked(withUserTracked(metadata, 'alice', true), 'ALICE', true);
		expect(twice.trackChanges?.users).toEqual(['ALICE']);
		expect(withUserTracked(twice, 'Alice', false)).toEqual(metadata);
	});

	it('makes the per-file tracking of before the project\'s', () => {
		const before: ProjectMetadata = { ...metadata, trackedFiles: ['/main.tex'] };
		expect(withLegacyTracking(before, { ownChanges: false })).toEqual({
			...metadata,
			trackChanges: { everyone: true },
		});
		expect(
			withLegacyTracking(metadata, { username: 'alice', ownChanges: true }),
		).toEqual({ ...metadata, trackChanges: { users: ['alice'] } });
		expect(withLegacyTracking(metadata, { username: 'alice', ownChanges: false })).toEqual(metadata);
	});
});
