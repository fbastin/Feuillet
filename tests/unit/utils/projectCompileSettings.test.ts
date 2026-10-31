import type { TypesetterUIField } from '@src/types/compilation';
import type { ProjectMetadata } from '@src/types/documents';
import {
	movedPath,
	sharedFieldValue,
	withMainFile,
	withSharedFieldValue,
} from '@src/utils/projectCompileSettings';

const engine: TypesetterUIField = {
	key: 'engine',
	label: 'Engine',
	kind: 'select',
	shared: true,
	defaultValue: 'pdflatex',
	options: [
		{ label: 'pdfLaTeX', value: 'pdflatex' },
		{ label: 'LuaLaTeX', value: 'lualatex' },
	],
};

const metadata: ProjectMetadata = { name: 'Thèse', description: '' };

describe("the project's compile settings", () => {
	it('follow the main document when it or its folder moves', () => {
		expect(movedPath('/main.tex', '/main.tex', '/these.tex')).toBe(
			'/these.tex',
		);
		expect(movedPath('/src/main.tex', '/src', '/chapitres')).toBe(
			'/chapitres/main.tex',
		);
		expect(movedPath('/src2/main.tex', '/src', '/chapitres')).toBeUndefined();
		expect(movedPath('/autre.tex', '/main.tex', '/x.tex')).toBeUndefined();
		expect(movedPath(undefined, '/main.tex', '/x.tex')).toBeUndefined();
	});

	it('keep a compiler per compile server, without touching the rest', () => {
		const set = withSharedFieldValue(
			{ ...metadata, typesetterOptions: { other: { engine: 'x' } } },
			'texlive',
			'engine',
			'lualatex',
		);
		expect(set).toEqual({
			name: 'Thèse',
			description: '',
			typesetterOptions: {
				other: { engine: 'x' },
				texlive: { engine: 'lualatex' },
			},
		});
		expect(sharedFieldValue(set, 'texlive', engine)).toBe('lualatex');

		const cleared = withSharedFieldValue(set, 'other', 'engine', undefined);
		expect(cleared.typesetterOptions).toEqual({
			texlive: { engine: 'lualatex' },
		});
		expect(
			withSharedFieldValue(cleared, 'texlive', 'engine', undefined),
		).toEqual(metadata);
	});

	it('ignore values a compiler does not offer', () => {
		const odd = withSharedFieldValue(metadata, 'texlive', 'engine', 'troff');
		expect(sharedFieldValue(odd, 'texlive', engine)).toBeUndefined();
		expect(sharedFieldValue(undefined, 'texlive', engine)).toBeUndefined();
		const flag: TypesetterUIField = { key: 'f', label: 'F', kind: 'boolean' };
		expect(
			sharedFieldValue(
				withSharedFieldValue(metadata, 'texlive', 'f', 'yes'),
				'texlive',
				flag,
			),
		).toBeUndefined();
	});

	it('set or clear the main document', () => {
		const set = withMainFile(metadata, '/these.tex');
		expect(set).toEqual({ ...metadata, mainFile: '/these.tex' });
		expect(withMainFile(set, undefined)).toEqual(metadata);
	});
});
