import {
	buildWorkflow,
	isFeuilletWorkflow,
	texliveImage,
} from '@src/utils/githubWorkflow';

describe('texliveImage', () => {
	it('follows the newest TeX Live for « latest » and for the newest year', () => {
		expect(texliveImage('latest', 2026).image).toBe('texlive/texlive:latest');
		expect(texliveImage('2026', 2026).image).toBe('texlive/texlive:latest');
		expect(texliveImage('2026', 2026).label).toMatch(/TL2026-historic/);
	});
	it('keeps a past year with its historic image', () => {
		expect(texliveImage('2025', 2026).image).toBe('texlive/texlive:TL2025-historic');
		expect(texliveImage('2010', 2026).image).toBe('texlive/texlive:TL2013-historic');
	});
});

describe('buildWorkflow', () => {
	const text = buildWorkflow({
		mainFile: '/chapitres/thèse principale.tex',
		engine: 'lualatex',
		version: '2025',
		latestYear: 2026,
	});

	it('is marked as Feuillet’s', () => {
		expect(isFeuilletWorkflow(text)).toBe(true);
		expect(isFeuilletWorkflow('name: mine\n')).toBe(false);
	});

	it('names the Feuillet it was made on, whichever server that is', () => {
		expect(text).toContain(`# (${window.location.origin}). It compiles`);
	});

	it('compiles the main file in its folder, with the engine and TeX Live of the project', () => {
		expect(text).toContain('container: texlive/texlive:TL2025-historic');
		expect(text).toContain(
			"latexmk -r \"$RUNNER_TEMP/latexmkrc\" -cd -pdflua -interaction=nonstopmode -file-line-error -shell-escape 'chapitres/thèse principale.tex'",
		);
		expect(text).toContain('path: "chapitres/thèse principale.pdf"');
	});

	it('runs on pushes and pull requests, reading only', () => {
		expect(text).toMatch(/on:\n {2}push:\n {2}pull_request:/);
		expect(text).toContain('permissions:\n  contents: read');
	});

	it('quotes a main file holding a quote', () => {
		expect(
			buildWorkflow({ mainFile: "l'été.tex", engine: 'x', version: 'latest', latestYear: null }),
		).toContain(`-pdf -interaction=nonstopmode -file-line-error -shell-escape 'l'"'"'été.tex'`);
	});
});
