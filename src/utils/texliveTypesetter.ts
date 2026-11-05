// src/utils/texliveTypesetter.ts
// Feuillet's TeX Live compile server (server/texlive) as a typesetter recipe.
// It is registered for every user whose `texlive-server` setting is set, under
// the same id everywhere, so shared projects compile the same way for all
// collaborators.
import type { TypesetterServerConfig } from '../services/GenericTypesetterService';
import type {
	TypesetterUIField,
	TypesetterUIFieldOption,
} from '../types/compilation';
import { ARXIV_TEXLIVE_YEARS } from './arxivPackage';

export const TEXLIVE_TYPESETTER_ID = 'texlive';
export const TEXLIVE_SERVER_SETTING = 'texlive-server';

// The project's compiler, as on Overleaf: the same for every collaborator.
const ENGINE_FIELD: TypesetterUIField = {
	key: 'engine',
	label: { key: '{typesetter} Engine:', params: { typesetter: 'LaTeX' } },
	kind: 'select',
	sendAs: 'option',
	shared: true,
	defaultValue: 'pdflatex',
	options: [
		{ label: 'pdfLaTeX', value: 'pdflatex' },
		{ label: 'LuaLaTeX', value: 'lualatex' },
		{ label: 'XeLaTeX', value: 'xelatex' },
	],
};

/** What the TeX Live server says of its years (its /health). */
export interface TexliveYears {
	/** The latest's, which "latest" compiles with. */
	year: number | null;
	/** Every year a compile may ask for, the latest's included. */
	years: number[];
}

/** Where the TeX Live server says which years it offers. */
export const texliveHealthUrl = (url: string): string | null => {
	try {
		const address = new URL(url);
		if (address.protocol !== 'ws:' && address.protocol !== 'wss:') return null;
		address.protocol = address.protocol === 'wss:' ? 'https:' : 'http:';
		address.pathname = `${address.pathname.replace(/\/+$/, '')}/health`;
		address.search = '';
		address.hash = '';
		return address.toString();
	} catch {
		return null;
	}
};

export const parseTexliveYears = (value: unknown): TexliveYears | null => {
	if (!value || typeof value !== 'object') return null;
	const { year, years } = value as { year?: unknown; years?: unknown };
	const isYear = (entry: unknown): entry is number =>
		Number.isInteger(entry) && (entry as number) > 1990;
	if (!Array.isArray(years)) return null;
	return {
		year: isYear(year) ? year : null,
		years: [...new Set(years.filter(isYear))].sort((a, b) => b - a),
	};
};

// As on Overleaf, the year of TeX Live is the project's: the latest by
// default, which follows Feuillet's updates, or a year that stays the same,
// as arXiv's. A project keeps a year that the server no longer offers, which
// then compiles with the latest (server/texlive/server.js).
const versionField = (info: TexliveYears | null): TypesetterUIField => {
	const years = info?.years ?? [];
	const options: TypesetterUIFieldOption[] = [
		{
			label: info?.year
				? {
						key: 'Latest (TeX Live {year})',
						params: { year: String(info.year) },
					}
				: 'Latest',
			value: 'latest',
		},
		...years.map((year) => ({
			label: {
				key: ARXIV_TEXLIVE_YEARS.includes(year)
					? 'TeX Live {year} (arXiv)'
					: 'TeX Live {year}',
				params: { year: String(year) },
			},
			value: String(year),
		})),
	];
	return {
		key: 'version',
		label: 'TeX Live version:',
		kind: 'select',
		sendAs: 'option',
		shared: true,
		defaultValue: 'latest',
		options,
		otherValues: {
			pattern: '^\\d{4}$',
			label: 'TeX Live {value} (not on this server: the latest compiles)',
		},
		...(years.length > 1
			? {
					help: "The latest follows Feuillet's updates; a year stays the same for this project.",
				}
			: {}),
	};
};

// Overleaf's compile options. The server forces a new run when they change.
const COMPILE_MODE_FIELD: TypesetterUIField = {
	key: 'mode',
	label: 'Compile mode:',
	kind: 'select',
	sendAs: 'option',
	defaultValue: 'normal',
	options: [
		{ label: 'Normal', value: 'normal' },
		{ label: 'Fast [draft]', value: 'draft' },
	],
};

const ERROR_HANDLING_FIELD: TypesetterUIField = {
	key: 'errors',
	label: 'Compile error handling:',
	kind: 'select',
	sendAs: 'option',
	defaultValue: 'continue',
	options: [
		{ label: 'Try to compile despite errors', value: 'continue' },
		{ label: 'Stop on first error', value: 'stop' },
	],
};

export function createTexliveTypesetterConfig(
	url: string,
	years: TexliveYears | null = null,
): TypesetterServerConfig {
	const version = versionField(years);
	return {
		id: TEXLIVE_TYPESETTER_ID,
		name: 'TeX Live',
		enabled: true,
		projectType: 'latex',
		projectGroup: 'tex',
		incrementalSync: true,
		compileTimeoutMs: 240_000,
		inputExtensions: ['tex'],
		inputFiles: [
			{
				extension: 'tex',
				label: { key: '{typesetter} File', params: { typesetter: 'LaTeX' } },
				mimeType: 'application/x-tex',
			},
		],
		outputFormats: [
			// One PDF viewer, as on Overleaf: TeXlyre's Canvas one showed the
			// same PDF a page at a time, and switching compiled again.
			{
				id: 'pdf',
				mimeType: 'application/pdf',
				rendererPluginId: 'pdf-renderer',
			},
		],
		transportConfig: { type: 'websocket', url },
		capabilities: { outline: false, stop: true },
		ui: {
			compile: {
				fields: [
					ENGINE_FIELD,
					version,
					COMPILE_MODE_FIELD,
					ERROR_HANDLING_FIELD,
				],
			},
			export: {
				label: 'Export',
				fields: [
					{
						key: 'format',
						label: 'Export Format:',
						kind: 'select',
						sendAs: 'format',
						defaultValue: 'pdf',
						options: [{ label: 'PDF', value: 'pdf' }],
					},
					ENGINE_FIELD,
					version,
				],
			},
			renderers: [{ format: 'pdf', label: 'PDF' }],
			info: {
				title: 'TeX Live',
				rows: [
					{
						label: {
							key: '{typesetter} Engine:',
							params: { typesetter: 'LaTeX' },
						},
						value: 'TeX Live (full)',
					},
					{
						label: {
							key: '{typesetter} Compilers:',
							params: { typesetter: 'LaTeX' },
						},
						value: 'pdfLaTeX, LuaLaTeX, XeLaTeX (latexmk)',
					},
					{ label: 'Output Formats:', value: 'PDF' },
				],
			},
		},
	};
}
