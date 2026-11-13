// The colors of the project tags (src/utils/tagColors.ts), as Overleaf's:
// nine offered or any other, kept as one setting that follows the account.
import { isSyncedSetting } from '@src/utils/accountPreferences';
import {
	PRESET_TAG_COLORS,
	TAG_COLORS_SETTING,
	cleanTagColors,
	withTagColor,
} from '@src/utils/tagColors';

describe('tag colors', () => {
	it('offers nine distinct colors and follows the account', () => {
		expect(PRESET_TAG_COLORS).toHaveLength(9);
		expect(new Set(PRESET_TAG_COLORS.map((entry) => entry.value)).size).toBe(9);
		expect(isSyncedSetting(TAG_COLORS_SETTING)).toBe(true);
		// With the editor's still cursor.
		expect(isSyncedSetting('editor-cursor-blink')).toBe(true);
	});

	it('keeps only well formed colors from a stored value', () => {
		expect(cleanTagColors(undefined)).toEqual({});
		expect(cleanTagColors(['#ff0000'])).toEqual({});
		expect(
			cleanTagColors({
				Thèse: '#D93F3F',
				cours: 'red',
				article: '#12345',
				'': '#000000',
				notes: 42,
			}),
		).toEqual({ Thèse: '#d93f3f' });
	});

	it('sets, changes and removes a color, letting go of tags no longer used', () => {
		const tags = ['Thèse', 'cours'];
		let colors = withTagColor({}, 'Thèse', '#3A7BD5', tags);
		expect(colors).toEqual({ Thèse: '#3a7bd5' });
		colors = withTagColor({ ...colors, ancien: '#000000' }, 'cours', '#3c9d4e', tags);
		expect(colors).toEqual({ Thèse: '#3a7bd5', cours: '#3c9d4e' });
		colors = withTagColor(colors, 'Thèse', null, tags);
		expect(colors).toEqual({ cours: '#3c9d4e' });
		// Not a color: none.
		expect(withTagColor(colors, 'cours', 'bleu', tags)).toEqual({});
	});

	it('stays within what the account keeps of a preference', () => {
		const tags = Array.from({ length: 150 }, (_, i) => `étiquette ${i} `.repeat(4));
		let colors = {};
		for (const tag of tags) colors = withTagColor(colors, tag, '#7356d6', tags);
		expect(JSON.stringify(colors).length).toBeLessThan(4096);
		expect(Object.keys(colors).length).toBeGreaterThan(40);
		// The latest chosen are kept.
		expect(colors).toHaveProperty([tags[149]]);
		expect(colors).not.toHaveProperty([tags[0]]);
	});
});
