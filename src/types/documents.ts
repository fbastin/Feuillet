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

export interface DocumentList {
	documents: Document[];
	gitRemote?: SharedGitRemote;
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
	};
}
