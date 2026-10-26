import { personalDictionaryService } from '@src/services/PersonalDictionaryService';

let currentUser: string | null = 'u1';
personalDictionaryService.followUser(() => currentUser);

describe('PersonalDictionaryService', () => {
	beforeEach(() => {
		localStorage.clear();
		currentUser = 'u1';
		personalDictionaryService.forget('u1');
		personalDictionaryService.forget('u2');
	});

	it('keeps each user’s words apart', () => {
		personalDictionaryService.add('Feuillet');
		expect(personalDictionaryService.has('Feuillet')).toBe(true);
		expect(personalDictionaryService.has('FEUILLET')).toBe(false);

		currentUser = 'u2';
		expect(personalDictionaryService.has('Feuillet')).toBe(false);
	});

	it('accepts the capitalized form of a lower-case word', () => {
		personalDictionaryService.add('fautte');
		expect(personalDictionaryService.has('Fautte')).toBe(true);
	});

	it('keeps a removed word as a deletion for the other devices', () => {
		personalDictionaryService.add('fautte');
		personalDictionaryService.remove('Fautte');

		expect(personalDictionaryService.has('fautte')).toBe(false);
		expect(personalDictionaryService.entries('u1')).toEqual([
			expect.objectContaining({ word: 'fautte', deleted: true }),
		]);
	});

	it('takes the most recent version from another device', () => {
		const listener = jest.fn();
		const stop = personalDictionaryService.addListener(listener);
		personalDictionaryService.merge('u1', [
			{ word: 'erreurr', updatedAt: 100 },
			{ word: 'bad', updatedAt: 'soon' },
			'nothing',
		]);
		expect(personalDictionaryService.has('erreurr')).toBe(true);
		expect(listener).toHaveBeenLastCalledWith('u1', false);

		personalDictionaryService.merge('u1', [
			{ word: 'erreurr', updatedAt: 50, deleted: true },
		]);
		expect(personalDictionaryService.has('erreurr')).toBe(true);

		personalDictionaryService.merge('u1', [
			{ word: 'erreurr', updatedAt: 100, deleted: true },
		]);
		expect(personalDictionaryService.has('erreurr')).toBe(false);

		listener.mockClear();
		personalDictionaryService.merge('u1', [
			{ word: 'erreurr', updatedAt: 100, deleted: true },
		]);
		expect(listener).not.toHaveBeenCalled();
		stop();
	});

	it('tells local changes from merged ones', () => {
		const listener = jest.fn();
		const stop = personalDictionaryService.addListener(listener);
		personalDictionaryService.add('motx');
		expect(listener).toHaveBeenCalledWith('u1', true);
		stop();
	});

	it('gives the words of this browser to the first user who opens them', () => {
		localStorage.setItem('feuillet-spelling-dictionary', JSON.stringify(['ancien']));
		personalDictionaryService.forget('u1');

		expect(personalDictionaryService.has('ancien')).toBe(true);
		expect(localStorage.getItem('feuillet-spelling-dictionary')).toBeNull();
		currentUser = 'u2';
		expect(personalDictionaryService.has('ancien')).toBe(false);
	});

	it('moves a guest’s words to the account they create', () => {
		personalDictionaryService.add('invité');
		personalDictionaryService.transfer('u1', 'u2');

		currentUser = 'u2';
		expect(personalDictionaryService.has('invité')).toBe(true);
		expect(localStorage.getItem('feuillet-spelling-dictionary-u1')).toBeNull();
	});
});
