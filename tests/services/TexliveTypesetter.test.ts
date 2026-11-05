import { typesetterRegistryService } from '@src/services/TypesetterRegistryService';
import type { TypesetterProvider } from '@src/types/compilation';
import {
	TEXLIVE_TYPESETTER_ID,
	createTexliveTypesetterConfig,
	parseTexliveYears,
	texliveHealthUrl,
} from '@src/utils/texliveTypesetter';
import { normalizeTypesetterConfig } from '@src/utils/toolConfigUtils';

const URL = 'wss://feuillet.example/texlive/';

const providerFrom = (
	overrides: Partial<TypesetterProvider>,
): TypesetterProvider => {
	const config = createTexliveTypesetterConfig(URL);
	return {
		id: config.id,
		label: config.name,
		source: 'chelys',
		projectType: config.projectType,
		projectGroup: config.projectGroup,
		inputExtensions: config.inputExtensions,
		outputFormats: config.outputFormats,
		transport: config.transportConfig,
		capabilities: config.capabilities,
		ui: config.ui,
		...overrides,
	};
};

describe('Feuillet TeX Live typesetter', () => {
	beforeAll(() => {
		typesetterRegistryService.registerBuiltins();
	});

	afterEach(() => {
		typesetterRegistryService.unregister(TEXLIVE_TYPESETTER_ID);
	});

	it('is a valid typesetter recipe for LaTeX projects', () => {
		const config = createTexliveTypesetterConfig(URL);
		const normalized = normalizeTypesetterConfig(config);

		expect(normalized).toMatchObject({
			id: TEXLIVE_TYPESETTER_ID,
			projectType: 'latex',
			projectGroup: 'tex',
			incrementalSync: true,
			transportConfig: { type: 'websocket', url: URL },
		});
		expect(normalized?.ui?.compile?.fields.map((field) => field.key)).toEqual([
			'engine',
			'version',
			'mode',
			'errors',
		]);
		// One PDF viewer, as on Overleaf.
		expect(normalized?.outputFormats.map((format) => format.id)).toEqual([
			'pdf',
		]);
		expect(normalized?.capabilities.stop).toBe(true);
		expect(
			normalized?.ui?.compile?.fields.some((field) => field.key === 'shellEscape'),
		).toBe(false);
	});

	it("keeps the compiler with the project, as Overleaf, and the rest with each person", () => {
		const normalized = normalizeTypesetterConfig(
			createTexliveTypesetterConfig(URL),
		);
		const shared = (fields = normalized?.ui?.compile?.fields ?? []) =>
			fields.filter((field) => field.shared).map((field) => field.key);

		// And its year of TeX Live, as Overleaf.
		expect(shared()).toEqual(['engine', 'version']);
		expect(shared(normalized?.ui?.export?.fields)).toEqual([
			'engine',
			'version',
		]);
	});

	it('keeps the built-in LaTeX compiler first when TeX Live is not preferred', () => {
		typesetterRegistryService.register(providerFrom({}));

		expect(typesetterRegistryService.getForProjectType('latex')?.id).toBe(
			'internal:latex',
		);
	});

	it('makes a preferred TeX Live the default LaTeX compiler', () => {
		typesetterRegistryService.register(providerFrom({ preferred: true }));

		expect(
			typesetterRegistryService.listForProjectGroup('tex').map(({ id }) => id),
		).toEqual([TEXLIVE_TYPESETTER_ID, 'internal:latex']);
		expect(typesetterRegistryService.getForProjectType('latex')?.id).toBe(
			TEXLIVE_TYPESETTER_ID,
		);
		// Projects without a recorded compiler (imports) use the default; an
		// explicit choice is kept.
		expect(typesetterRegistryService.resolve('latex')?.id).toBe(
			TEXLIVE_TYPESETTER_ID,
		);
		expect(
			typesetterRegistryService.resolve('latex', 'internal:latex')?.id,
		).toBe('internal:latex');
	});
});

describe('the years of TeX Live', () => {
	const versionOf = (years: Parameters<typeof createTexliveTypesetterConfig>[1]) =>
		createTexliveTypesetterConfig(URL, years).ui?.compile?.fields.find(
			(field) => field.key === 'version',
		);

	it('are asked of the server next to its socket', () => {
		expect(texliveHealthUrl('wss://feuillet.example/texlive/')).toBe(
			'https://feuillet.example/texlive/health',
		);
		expect(texliveHealthUrl('ws://localhost:7045')).toBe(
			'http://localhost:7045/health',
		);
		expect(texliveHealthUrl('https://feuillet.example/')).toBeNull();
		expect(texliveHealthUrl('not a url')).toBeNull();
	});

	it('are read from what the server says, newest first', () => {
		expect(parseTexliveYears({ year: 2026, years: [2025, 2026, 2025] })).toEqual({
			year: 2026,
			years: [2026, 2025],
		});
		expect(parseTexliveYears({ status: 'ok' })).toBeNull();
		expect(parseTexliveYears({ year: 'x', years: [2026, 'y', 12] })).toEqual({
			year: null,
			years: [2026],
		});
	});

	it("offer the latest, then each year, arXiv's said, as the project's choice", () => {
		const field = versionOf({ year: 2026, years: [2026, 2025] });
		expect(field).toMatchObject({
			kind: 'select',
			shared: true,
			sendAs: 'option',
			defaultValue: 'latest',
		});
		expect(field?.options).toEqual([
			{
				label: { key: 'Latest (TeX Live {year})', params: { year: '2026' } },
				value: 'latest',
			},
			{ label: { key: 'TeX Live {year}', params: { year: '2026' } }, value: '2026' },
			{
				label: { key: 'TeX Live {year} (arXiv)', params: { year: '2025' } },
				value: '2025',
			},
		]);
		expect(field?.help).toBeDefined();
		// The export menu shows it too.
		expect(
			createTexliveTypesetterConfig(URL, null).ui?.export?.fields.map(
				(entry) => entry.key,
			),
		).toEqual(['format', 'engine', 'version']);
	});

	it('before the server says, offer the latest alone and keep any year', () => {
		const field = versionOf(null);
		expect(field?.options?.map((option) => option.value)).toEqual(['latest']);
		expect(field?.help).toBeUndefined();
		expect(new RegExp(field?.otherValues?.pattern ?? '').test('2025')).toBe(true);
		expect(new RegExp(field?.otherValues?.pattern ?? '').test('20255')).toBe(
			false,
		);
	});

	it('survive the normalization of recipes', () => {
		const normalized = normalizeTypesetterConfig(
			createTexliveTypesetterConfig(URL, { year: 2026, years: [2026, 2025] }),
		);
		const field = normalized?.ui?.compile?.fields.find(
			(entry) => entry.key === 'version',
		);
		expect(field?.otherValues).toEqual({
			pattern: '^\\d{4}$',
			label: 'TeX Live {value} (not on this server: the latest compiles)',
		});
		expect(field?.shared).toBe(true);
	});
});
