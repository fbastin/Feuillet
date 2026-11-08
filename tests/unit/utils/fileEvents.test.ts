import { isAtOrUnder, isDirectChild } from '../../../src/utils/fileEvents';

describe('folder paths', () => {
	it('tells a folder from another whose name begins alike', () => {
		expect(isAtOrUnder('/chap1/intro.tex', '/chap1')).toBe(true);
		expect(isAtOrUnder('/chap1', '/chap1')).toBe(true);
		expect(isAtOrUnder('/chap10', '/chap1')).toBe(false);
		expect(isAtOrUnder('/chap10/fin.tex', '/chap1')).toBe(false);
	});

	it('finds what is right inside a folder, and nothing more', () => {
		expect(isDirectChild('/chap1/intro.tex', '/chap1')).toBe(true);
		expect(isDirectChild('/chap1/figures', '/chap1')).toBe(true);
		expect(isDirectChild('/chap1/figures/a.png', '/chap1')).toBe(false);
		expect(isDirectChild('/chap10', '/chap1')).toBe(false);
		expect(isDirectChild('/chap10/fin.tex', '/chap1')).toBe(false);
		expect(isDirectChild('/chap1', '/chap1')).toBe(false);
	});

	it('takes the project root as a folder', () => {
		expect(isDirectChild('/main.tex', '/')).toBe(true);
		expect(isDirectChild('/a', '/')).toBe(true);
		expect(isDirectChild('/chap1/intro.tex', '/')).toBe(false);
		expect(isDirectChild('/', '/')).toBe(false);
	});
});
