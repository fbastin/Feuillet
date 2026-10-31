// src/types/documents.ts
import type { ChatMessage } from './chat';
import type { TypstPdfOptions, TypstOutputFormat } from './typst';
import type { LaTeXEngine, LaTeXOutputFormat } from './latex';
import type { ProjectType, ProjectGroup } from './projects';

export interface Document {
	id: string;
	content: string;
	name: string;
	createdAt?: number;
}

// The Git repository a project is linked to, shared with its collaborators;
// each of them syncs with their own account on the provider.
export interface SharedGitRemote {
	providerId: string;
	repositoryId: string;
	repositoryLabel: string;
	branch: string;
	// The remote commit the project was last pushed or pulled as.
	syncedCommit?: string;
}

// Where a file added from another project or from a URL came from, so that
// it can be refreshed, as Overleaf's linked files.
export type ImportedFileSource =
	| { kind: 'url'; url: string }
	| { kind: 'project'; projectId: string; projectName: string; path: string }
	// The PDF another project compiles to, compiled again to refresh it.
	| { kind: 'output'; projectId: string; projectName: string };

export interface ImportedFile {
	source: ImportedFileSource;
	// SHA-256 of the content as last imported, to tell whether it was changed
	// in this project since.
	checksum: string;
	importedAt: number;
	importedBy?: string;
}

export interface DocumentList {
	documents: Document[];
	gitRemote?: SharedGitRemote;
	// By path in the project.
	importedFiles?: Record<string, ImportedFile>;
	currentDocId: string;
	cursors: unknown[];
	chatMessages?: ChatMessage[];
	projectMetadata?: {
		name: string;
		description: string;
		type?: ProjectType;
		group?: ProjectGroup;
		compilerId?: string;
		mainFile?: string;
		latexEngine?: LaTeXEngine;
		typstEngine?: string;
		latexOutputFormat?: LaTeXOutputFormat;
		typstOutputFormat?: TypstOutputFormat;
		latexAutoCompileOnSave?: boolean;
		typstAutoCompileOnSave?: boolean;
		typstPdfOptions?: TypstPdfOptions;
		trackedFiles?: string[];
		// Options of external compilers kept with the project, by compiler
		// id, as Overleaf keeps the compiler: the same for every collaborator.
		typesetterOptions?: Record<
			string,
			Record<string, string | number | boolean>
		>;
	};
}

export type ProjectMetadata = NonNullable<DocumentList['projectMetadata']>;
