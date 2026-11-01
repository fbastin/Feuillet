import type { ProjectMetadata } from '@src/types/documents';
import type { Project } from '@src/types/projects';
import {
	BROWSER_COMPILER_CUTOFF,
	choosesBrowserCompiler,
	listedBeforeTexlive,
	movedToTexlive,
	needsTexliveMove,
	texliveEngineFor,
} from '@src/utils/browserCompilerMigration';

const browser: ProjectMetadata = {
	name: 'Thèse',
	description: '',
	type: 'latex',
	compilerId: 'internal:latex',
};

const listed = (fields: Partial<Project>): Project => ({
	id: 'p1',
	name: 'Thèse',
	description: '',
	type: 'latex',
	docUrl: 'yjs:p1',
	ownerId: 'u1',
	tags: [],
	isFavorite: false,
	createdAt: BROWSER_COMPILER_CUTOFF - 86_400_000,
	updatedAt: BROWSER_COMPILER_CUTOFF - 86_400_000,
	...fields,
});

describe('moving projects from the browser compiler to TeX Live', () => {
	it('moves projects that have had the browser compiler since before', () => {
		expect(needsTexliveMove(browser)).toBe(true);
		expect(needsTexliveMove({ ...browser, compilerId: 'texlive' })).toBe(false);
		expect(needsTexliveMove({ ...browser, compilerId: undefined })).toBe(false);
		expect(needsTexliveMove({ ...browser, compilerId: 'internal:typst' })).toBe(
			false,
		);
		expect(needsTexliveMove(undefined)).toBe(false);
	});

	it('keeps a browser compiler chosen while TeX Live was offered', () => {
		expect(needsTexliveMove({ ...browser, browserCompilerChosen: true })).toBe(
			false,
		);
		expect(choosesBrowserCompiler('internal:latex', true)).toBe(true);
		// Without TeX Live there was no choice to make.
		expect(choosesBrowserCompiler('internal:latex', false)).toBe(false);
		expect(choosesBrowserCompiler('texlive', true)).toBe(false);
		expect(choosesBrowserCompiler(undefined, true)).toBe(false);
	});

	it('gives each browser engine its TeX Live counterpart', () => {
		expect(texliveEngineFor('pdftex')).toBe('pdflatex');
		expect(texliveEngineFor('busytex-pdftex')).toBe('pdflatex');
		expect(texliveEngineFor('xetex')).toBe('xelatex');
		expect(texliveEngineFor('busytex-xetex')).toBe('xelatex');
		expect(texliveEngineFor('busytex-luatex')).toBe('lualatex');
		expect(texliveEngineFor('other')).toBeUndefined();
		expect(texliveEngineFor(undefined)).toBeUndefined();
	});

	it('takes the engine and main document along', () => {
		expect(movedToTexlive({ ...browser, latexEngine: 'xetex' })).toEqual({
			...browser,
			latexEngine: 'xetex',
			compilerId: 'texlive',
			typesetterOptions: { texlive: { engine: 'xelatex' } },
		});
		// What this browser chose, when the project has nothing.
		expect(
			movedToTexlive(browser, {
				engine: 'busytex-luatex',
				mainFile: '/these.tex',
			}),
		).toEqual({
			...browser,
			compilerId: 'texlive',
			mainFile: '/these.tex',
			typesetterOptions: { texlive: { engine: 'lualatex' } },
		});
		// No engine chosen: TeX Live's default.
		expect(movedToTexlive(browser)).toEqual({
			...browser,
			compilerId: 'texlive',
		});
	});

	it("keeps what the project has for TeX Live, and its main document", () => {
		const project: ProjectMetadata = {
			...browser,
			latexEngine: 'xetex',
			mainFile: '/main.tex',
			typesetterOptions: { texlive: { engine: 'lualatex', mode: 'draft' } },
		};
		expect(
			movedToTexlive(project, { engine: 'pdftex', mainFile: '/autre.tex' }),
		).toEqual({ ...project, compilerId: 'texlive' });
	});

	it('shows TeX Live in the list for projects listed before', () => {
		expect(listedBeforeTexlive(listed({ compilerId: 'internal:latex' }))).toBe(
			true,
		);
		// Changed in the list since: chosen then, or moved once opened.
		expect(
			listedBeforeTexlive(
				listed({
					compilerId: 'internal:latex',
					accountUpdatedAt: BROWSER_COMPILER_CUTOFF + 1,
				}),
			),
		).toBe(false);
		expect(listedBeforeTexlive(listed({ compilerId: 'texlive' }))).toBe(false);
		expect(listedBeforeTexlive(listed({ compilerId: undefined }))).toBe(false);
	});
});
