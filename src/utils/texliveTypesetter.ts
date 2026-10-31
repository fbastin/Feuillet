// src/utils/texliveTypesetter.ts
// Feuillet's TeX Live compile server (server/texlive) as a typesetter recipe.
// It is registered for every user whose `texlive-server` setting is set, under
// the same id everywhere, so shared projects compile the same way for all
// collaborators.
import type { TypesetterServerConfig } from '../services/GenericTypesetterService';
import type { TypesetterUIField } from '../types/compilation';

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
): TypesetterServerConfig {
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
