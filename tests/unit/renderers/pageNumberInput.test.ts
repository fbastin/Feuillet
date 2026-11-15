import { steppedPage } from '@extras/renderers/shared/pageNumberInput';

// The up and down keys in the PDF viewers' page number go a page on or
// back at once, from the number shown, within the document.
describe('steppedPage', () => {
	it('steps from the number shown, or else the current page', () => {
		expect(steppedPage('ArrowUp', '2', 2, 5)).toBe(3);
		expect(steppedPage('ArrowDown', '2', 2, 5)).toBe(1);
		// A number typed, not gone to yet.
		expect(steppedPage('ArrowUp', '4', 2, 5)).toBe(5);
		expect(steppedPage('ArrowDown', '', 3, 5)).toBe(2);
	});

	it('stays within the document', () => {
		expect(steppedPage('ArrowUp', '5', 5, 5)).toBe(5);
		expect(steppedPage('ArrowDown', '1', 1, 5)).toBe(1);
		expect(steppedPage('ArrowUp', '1', 1, 0)).toBe(1);
	});

	it('leaves other keys alone', () => {
		expect(steppedPage('Enter', '3', 2, 5)).toBeNull();
		expect(steppedPage('7', '3', 2, 5)).toBeNull();
	});
});
