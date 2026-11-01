// src/utils/browserCompilerMigration.ts
// Projects made before Feuillet compiled on its TeX Live server kept
// TeXlyre's browser compiler (SwiftLaTeX or BusyTeX). As on Overleaf, where
// every project compiles on the server, they move to TeX Live once, with
// the engine and the main document they had. A browser compiler someone
// chooses since stays.
import type { ProjectMetadata } from '../types/documents';
import type { Project } from '../types/projects';
import { accountUpdatedAt } from './accountSyncUtils';
import { withMainFile, withSharedFieldValue } from './projectCompileSettings';
import { TEXLIVE_TYPESETTER_ID } from './texliveTypesetter';

export const BROWSER_LATEX_COMPILER_ID = 'internal:latex';

// When the move was published: a project listed with the browser compiler
// and unchanged since has it from before.
export const BROWSER_COMPILER_CUTOFF = Date.UTC(2026, 10, 1, 15, 30);

// The browser engines and their TeX Live counterparts.
const TEXLIVE_ENGINES: Record<string, string> = {
	pdftex: 'pdflatex',
	'busytex-pdftex': 'pdflatex',
	xetex: 'xelatex',
	'busytex-xetex': 'xelatex',
	'busytex-luatex': 'lualatex',
};

export const texliveEngineFor = (engine: unknown): string | undefined =>
	typeof engine === 'string' ? TEXLIVE_ENGINES[engine] : undefined;

/** Whether the project still compiles in the browser from before TeX Live. */
export const needsTexliveMove = (metadata: ProjectMetadata | undefined) =>
	metadata?.compilerId === BROWSER_LATEX_COMPILER_ID &&
	metadata.browserCompilerChosen !== true;

/**
 * The project on TeX Live. The engine and main document come from the
 * project, or else from what this browser chose for it; TeX Live's own,
 * if the project has them already, stay.
 */
export function movedToTexlive(
	metadata: ProjectMetadata,
	local: { engine?: unknown; mainFile?: unknown } = {},
): ProjectMetadata {
	let next: ProjectMetadata = {
		...metadata,
		compilerId: TEXLIVE_TYPESETTER_ID,
	};
	const engine = texliveEngineFor(metadata.latexEngine ?? local.engine);
	if (
		engine &&
		metadata.typesetterOptions?.[TEXLIVE_TYPESETTER_ID]?.engine === undefined
	) {
		next = withSharedFieldValue(next, TEXLIVE_TYPESETTER_ID, 'engine', engine);
	}
	if (!next.mainFile && typeof local.mainFile === 'string' && local.mainFile) {
		next = withMainFile(next, local.mainFile);
	}
	return next;
}

/**
 * Whether a person choosing this compiler for a project chooses the browser
 * one while TeX Live is offered: then the project keeps it.
 */
export const choosesBrowserCompiler = (
	compilerId: string | undefined,
	texliveOffered: boolean,
) => compilerId === BROWSER_LATEX_COMPILER_ID && texliveOffered;

/** Whether a listed project has had the browser compiler since before. */
export const listedBeforeTexlive = (
	project: Project,
	cutoff = BROWSER_COMPILER_CUTOFF,
) =>
	project.compilerId === BROWSER_LATEX_COMPILER_ID &&
	accountUpdatedAt(project) < cutoff;
