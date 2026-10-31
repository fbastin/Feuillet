import { typesetterRegistryService } from '@src/services/TypesetterRegistryService';
import type { TypesetterProvider } from '@src/types/compilation';
import {
	TEXLIVE_TYPESETTER_ID,
	createTexliveTypesetterConfig,
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
			'format',
			'engine',
			'mode',
			'errors',
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

		expect(shared()).toEqual(['engine']);
		expect(shared(normalized?.ui?.export?.fields)).toEqual(['engine']);
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
