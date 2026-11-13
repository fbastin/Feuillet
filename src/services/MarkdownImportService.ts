// src/services/MarkdownImportService.ts
// A project from a Markdown file, as Overleaf's « Import Markdown »: Pandoc,
// on Feuillet's TeX Live server, makes a LaTeX document of it, which the new
// project compiles; the Markdown file stays beside it, and an archive's
// other files (its images) with them.
import { nanoid } from 'nanoid';

import i18next from 'i18next';
import { t } from '@/i18n';
import type { FileNode } from '../types/files';
import { isArchiveFile } from '../utils/archiveUtils';
import { getMimeType, isBinaryFile } from '../utils/fileUtils';
import {
	chooseMainMarkdown,
	isMarkdownFile,
	latexPathFor,
	markdownBody,
	markdownDeclaresLanguage,
	markdownTitle,
} from '../utils/markdownConversion';
import { guessLanguage } from '../utils/spellingUtils';
import { TEXLIVE_TYPESETTER_ID } from '../utils/texliveTypesetter';
import { genericTypesetterService } from './GenericTypesetterService';
import { projectSeedService } from './ProjectSeedService';
import { typesetterRegistryService } from './TypesetterRegistryService';

export class MarkdownImportError extends Error {}

/** What to pick: a Markdown file, or an archive with one and its images. */
export const MARKDOWN_IMPORT_ACCEPT = '.md,.markdown,.zip';

const fileNode = (path: string, content: ArrayBuffer): FileNode => {
	const name = path.split('/').pop() ?? path;
	return {
		id: nanoid(),
		name,
		path,
		type: 'file',
		content,
		lastModified: Date.now(),
		size: content.byteLength,
		mimeType: getMimeType(name),
		isBinary: isBinaryFile(name),
	};
};

const bytesOf = (content: FileNode['content']): Uint8Array =>
	typeof content === 'string'
		? new TextEncoder().encode(content)
		: new Uint8Array(content ?? new ArrayBuffer(0));

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

export interface MarkdownProject {
	name: string;
	files: FileNode[];
	/** The LaTeX document made, to open first. */
	mainFile: string;
}

class MarkdownImportService {
	/** The files of a new project made from `file`, converted. */
	async projectFrom(file: File): Promise<MarkdownProject> {
		let nodes: FileNode[];
		if (isMarkdownFile(file.name)) {
			nodes = [fileNode(`/${file.name}`, await file.arrayBuffer())];
		} else if (isArchiveFile(file.name)) {
			nodes = await projectSeedService.filesFromArchive(file);
		} else {
			throw new MarkdownImportError(
				t('Choose a Markdown file (.md), or a .zip archive with one.'),
			);
		}
		const paths = nodes
			.filter((node) => node.type === 'file')
			.map((node) => node.path);
		const markdownPath = chooseMainMarkdown(paths);
		const markdownNode = nodes.find((node) => node.path === markdownPath);
		if (!markdownPath || !markdownNode) {
			throw new MarkdownImportError(t('The archive has no Markdown file.'));
		}
		const bytes = bytesOf(markdownNode.content);
		const text = new TextDecoder().decode(bytes);

		const provider = typesetterRegistryService.get(TEXLIVE_TYPESETTER_ID);
		if (!provider) {
			throw new MarkdownImportError(
				t('Converting Markdown needs the TeX Live compile server.'),
			);
		}
		// Its language, for LaTeX's hyphenation and typography: as it says,
		// else as its text reads, else the interface's.
		const language = markdownDeclaresLanguage(text)
			? undefined
			: (guessLanguage(markdownBody(text)) ??
					(i18next.language || '').split('-')[0]) ||
				undefined;

		const result = await genericTypesetterService
			.compileSeparately(provider.id, {
				mainFile: markdownPath,
				format: 'latex',
				files: [{ path: markdownPath, content: bytes }],
				options: {
					action: 'pandoc',
					to: 'latex',
					...(language ? { lang: language } : {}),
				},
			})
			.catch((error: unknown) => {
				throw new MarkdownImportError(
					error instanceof Error
						? error.message
						: t('The TeX Live compile server could not be reached.'),
				);
			});
		if (result.status !== 0 || !result.output) {
			throw new MarkdownImportError(
				t('Pandoc could not convert {name}: {reason}', {
					name: markdownNode.name,
					reason: result.log.trim() || t('no reason given'),
				}),
			);
		}

		const mainFile = latexPathFor(markdownPath, paths);
		nodes.push(fileNode(mainFile, toArrayBuffer(result.output)));
		const name =
			markdownTitle(text) ??
			(projectSeedService
				.projectNameFromArchive(file.name)
				.replace(/\.(md|markdown)$/i, '') ||
				file.name);
		return { name, files: nodes, mainFile };
	}
}

export const markdownImportService = new MarkdownImportService();
