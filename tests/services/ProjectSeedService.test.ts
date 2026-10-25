import { File as NodeFile } from 'node:buffer';
import JSZip from 'jszip';

const mockFileStore = {
	initialize: jest.fn(async () => undefined),
	batchStoreFiles: jest.fn(async () => []),
};

jest.mock('@src/services/FileStoreService', () => ({
	fileStoreService: mockFileStore,
}));

import { projectSeedService } from '@src/services/ProjectSeedService';

const zipFile = async (
	entries: Record<string, string>,
	name = 'paper.zip',
): Promise<File> => {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries)) {
		zip.file(path, content);
	}
	const data = await zip.generateAsync({ type: 'uint8array' });
	return new NodeFile([data], name, {
		type: 'application/zip',
	}) as unknown as File;
};

const paths = (files: Array<{ path: string }>) =>
	files.map((file) => file.path).sort();

describe('ProjectSeedService', () => {
	beforeEach(() => jest.clearAllMocks());

	it('keeps an Overleaf download at the project root', async () => {
		const files = await projectSeedService.filesFromArchive(
			await zipFile({
				'main.tex': '\\documentclass{article}',
				'figures/plot.png': 'png',
			}),
		);

		expect(paths(files)).toEqual(['/figures', '/figures/plot.png', '/main.tex']);
	});

	it('unwraps a single top-level folder and drops macOS archive noise', async () => {
		const files = await projectSeedService.filesFromArchive(
			await zipFile({
				'paper-main/main.tex': '\\documentclass{article}',
				'paper-main/sections/intro.tex': '\\section{Intro}',
				'__MACOSX/paper-main/._main.tex': 'resource fork',
				'paper-main/.DS_Store': 'finder',
			}),
		);

		expect(paths(files)).toEqual([
			'/main.tex',
			'/sections',
			'/sections/intro.tex',
		]);
	});

	it('names the project after the archive', () => {
		expect(projectSeedService.projectNameFromArchive('Thesis draft.zip')).toBe(
			'Thesis draft',
		);
		expect(projectSeedService.projectNameFromArchive('slides.tar.gz')).toBe(
			'slides',
		);
	});

	it('detects the project type and the main document', async () => {
		const latex = await projectSeedService.filesFromArchive(
			await zipFile({
				'chapters/one.tex': '\\chapter{One}',
				'thesis.tex': '\\documentclass{book}',
			}),
		);
		expect(projectSeedService.detectProjectType(latex)).toBe('latex');
		expect(projectSeedService.findMainFile(latex, 'latex')).toBe('/thesis.tex');

		const typst = await projectSeedService.filesFromArchive(
			await zipFile({ 'lib.typ': '', 'main.typ': '= Hello' }),
		);
		expect(projectSeedService.detectProjectType(typst)).toBe('typst');
		expect(projectSeedService.findMainFile(typst, 'typst')).toBe('/main.typ');
	});

	it('stores files into the target project', async () => {
		const files = [
			{ id: 'a', name: 'main.tex', path: '/main.tex', type: 'file' as const, lastModified: 1 },
		];
		await projectSeedService.storeFiles('project-1', files);

		expect(mockFileStore.initialize).toHaveBeenCalledWith('yjs:project-1');
		expect(mockFileStore.batchStoreFiles).toHaveBeenCalledWith(files, {
			showConflictDialog: false,
			preserveTimestamp: false,
		});
	});
});
