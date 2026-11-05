import type { TypesetterUIField } from '@src/types/compilation';
import type { ProjectMetadata } from '@src/types/documents';
import { movedPath } from '@src/utils/fileEvents';
import {
	optionsWith,
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

describe('a select that keeps values no option offers', () => {
	const version: TypesetterUIField = {
		key: 'version',
		label: 'TeX Live version:',
		kind: 'select',
		shared: true,
		defaultValue: 'latest',
		options: [
			{ label: 'Latest', value: 'latest' },
			{ label: 'TeX Live 2025', value: '2025' },
		],
		otherValues: { pattern: '^\\d{4}$', label: 'TeX Live {value} (gone)' },
	};
	const withVersion = (value: unknown): ProjectMetadata =>
		({
			...metadata,
			typesetterOptions: { texlive: { version: value } },
		}) as ProjectMetadata;

	it("keeps a year the server stopped offering, as the project's", () => {
		expect(sharedFieldValue(withVersion('2025'), 'texlive', version)).toBe(
			'2025',
		);
		expect(sharedFieldValue(withVersion('2024'), 'texlive', version)).toBe(
			'2024',
		);
		expect(
			sharedFieldValue(withVersion('nonsense'), 'texlive', version),
		).toBeUndefined();
		expect(sharedFieldValue(withVersion(2024), 'texlive', version)).toBeUndefined();
		// A select without the pattern still takes its options only.
		expect(
			sharedFieldValue(
				{ ...metadata, typesetterOptions: { texlive: { engine: '2024' } } },
				'texlive',
				engine,
			),
		).toBeUndefined();
	});

	it('shows that year among the options, with its label', () => {
		expect(optionsWith(version, '2025')).toBe(version.options);
		expect(optionsWith(version, '2024').at(-1)).toEqual({
			value: '2024',
			label: { key: 'TeX Live {value} (gone)', params: { value: '2024' } },
		});
		expect(optionsWith(engine, '2024')).toBe(engine.options);
	});

	it('ignores a pattern that is not one', () => {
		const broken = { ...version, otherValues: { pattern: '(', label: 'x' } };
		expect(sharedFieldValue(withVersion('2024'), 'texlive', broken)).toBeUndefined();
	});
});
