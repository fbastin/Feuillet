import {
	chooseLatexMainFile,
	isRootLatexDocument,
	outputFilesOf,
} from '@src/utils/compilerUtils';

describe('main document', () => {
	it('tells documents from the parts they include', () => {
		expect(isRootLatexDocument('\\documentclass{article}\n')).toBe(true);
		expect(isRootLatexDocument('% A thesis\n\\documentclass[12pt]{report}')).toBe(
			true,
		);
		expect(isRootLatexDocument('\\chapter{Introduction}\n')).toBe(false);
		expect(isRootLatexDocument('% \\documentclass{article}\n\\section{A}')).toBe(
			false,
		);
		expect(isRootLatexDocument('Text % \\documentclass{x}')).toBe(false);
	});

	const files: Record<string, string> = {
		'/main.tex': '\\documentclass{book}',
		'/chapters/one.tex': '\\chapter{One}',
		'/chapters/two.tex': '\\chapter{Two}',
		'/notes/standalone.tex': '\\documentclass{article}',
		'/a.tex': '\\section{A}',
	};
	const isRoot = async (path: string) => isRootLatexDocument(files[path] ?? '');
	const available = Object.keys(files);

	it('compiles the open file when it is a document', async () => {
		expect(
			await chooseLatexMainFile(
				'/notes/standalone.tex',
				'/main.tex',
				available,
				isRoot,
			),
		).toBe('/notes/standalone.tex');
	});

	it('compiles the document compiled before from one of its parts', async () => {
		expect(
			await chooseLatexMainFile(
				'/chapters/one.tex',
				'/notes/standalone.tex',
				available,
				isRoot,
			),
		).toBe('/notes/standalone.tex');
	});

	it('otherwise compiles main.tex, then the shallowest document', async () => {
		expect(
			await chooseLatexMainFile('/chapters/one.tex', undefined, available, isRoot),
		).toBe('/main.tex');
		expect(
			await chooseLatexMainFile(
				'/chapters/one.tex',
				'/chapters/two.tex',
				available.filter((path) => path !== '/main.tex'),
				isRoot,
			),
		).toBe('/notes/standalone.tex');
	});

	it('keeps the open file when no file is a document', async () => {
		const parts = ['/chapters/one.tex', '/a.tex'];
		expect(await chooseLatexMainFile('/a.tex', undefined, parts, isRoot)).toBe(
			'/a.tex',
		);
		expect(await chooseLatexMainFile(undefined, undefined, parts, isRoot)).toBe(
			'/chapters/one.tex',
		);
	});
});

describe('output files', () => {
	const listed = (data: unknown, id = 'output-files') => [
		{
			id: 'synctex',
			name: 'main.synctex.gz',
			data: new Uint8Array([1, 2, 3]),
		},
		{
			id,
			name: 'output-files.json',
			data: new TextEncoder().encode(
				typeof data === 'string' ? data : JSON.stringify(data),
			),
		},
	];

	it('reads the files a compile reply lists', () => {
		expect(
			outputFilesOf(
				listed([
					{ path: 'main.aux', size: 120 },
					{ path: 'chapitres/intro.aux', size: 0 },
				]),
			),
		).toEqual([
			{ path: 'main.aux', size: 120 },
			{ path: 'chapitres/intro.aux', size: 0 },
		]);
	});

	it('lists none from a server that lists none, or lists them wrongly', () => {
		expect(outputFilesOf(undefined)).toEqual([]);
		expect(outputFilesOf(listed([], 'other'))).toEqual([]);
		expect(outputFilesOf(listed('not json'))).toEqual([]);
		expect(outputFilesOf(listed({ path: 'main.aux', size: 1 }))).toEqual([]);
		expect(
			outputFilesOf(
				listed([
					null,
					{ path: '', size: 1 },
					{ path: 'main.log' },
					{ path: 7, size: 1 },
					{ path: 'main.bbl', size: 2, extra: true },
				]),
			),
		).toEqual([{ path: 'main.bbl', size: 2 }]);
	});
});
