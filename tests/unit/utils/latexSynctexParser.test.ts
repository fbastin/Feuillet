import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseSynctex } from '@src/utils/latexSynctexParser';

// tests/fixtures/synctex: main.tex, which inputs chapitre.tex, compiled with
// pdflatex -synctex=1. The expected answers are those of the synctex tool
// (synctex edit and synctex view) for the same PDF.
const fixture = path.join(__dirname, '../../fixtures/synctex/main.synctex.gz');
const data = parseSynctex(new Uint8Array(readFileSync(fixture)));

describe('SyncTeX, from the PDF to the source', () => {
	it.each([
		[1, 203.8, 129.8, 'main.tex', 3, 'a heading'],
		[1, 203.8, 178.0, 'main.tex', 4, 'a paragraph, boxed where it ends'],
		[1, 203.8, 237.8, 'main.tex', 5, 'its last line, made where it ends'],
		[1, 203.8, 273.6, 'main.tex', 6, 'the next paragraph'],
		[1, 203.8, 360.8, 'chapitre.tex', 1, 'a heading from an input file'],
		[1, 203.8, 379.7, 'chapitre.tex', 2, 'a paragraph from it'],
		[1, 203.8, 391.7, 'chapitre.tex', 3, 'its second source line'],
		[2, 203.8, 129.8, 'main.tex', 9, 'the second page'],
		[2, 203.8, 153.5, 'main.tex', 10, 'a line of text'],
		[2, 335.8, 153.5, 'main.tex', 11, 'the next source line, on the same line'],
	])('page %i at (%f, %f) is %s:%i: %s', (page, x, y, file, line) => {
		const hit = data.reverse(page, x, y);
		expect(hit?.file.split('/').pop()).toBe(file);
		expect(hit?.line).toBe(line);
	});
});

describe('SyncTeX, from the source to the PDF', () => {
	// The bottom of each line marked, in PDF points from the top of the page.
	const marked = (file: string, line: number) => {
		const found = data.forward(file, line);
		return {
			page: found?.page,
			bottoms: found?.rects
				.map((rect) => Number((rect.y + rect.height).toFixed(1)))
				.sort((a, b) => a - b),
		};
	};

	it('marks the lines holding what was read on a line', () => {
		expect(marked('main.tex', 3)).toEqual({ page: 1, bottoms: [134.8, 134.8] });
		expect(marked('main.tex', 4)).toEqual({
			page: 1,
			bottoms: [158.5, 170.5, 182.4, 194.4, 206.3, 218.3, 230.3],
		});
		expect(marked('main.tex', 5)).toEqual({ page: 1, bottoms: [242.2] });
	});

	it('in input files too, line by line', () => {
		expect(marked('chapitre.tex', 2)).toEqual({ page: 1, bottoms: [384.1] });
		expect(marked('chapitre.tex', 3)).toEqual({ page: 1, bottoms: [384.1, 396.1] });
	});

	it('on later pages', () => {
		expect(marked('main.tex', 10)).toEqual({ page: 2, bottoms: [158.5] });
	});

	it('in PDF points, as the PDF is drawn', () => {
		const first = data.forward('main.tex', 10)?.rects[0];
		expect(first?.x).toBeCloseTo(133.77, 1);
	});
});
