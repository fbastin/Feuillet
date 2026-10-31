import type { ImportedFile } from '@src/types/documents';
import { isAtOrUnder } from '@src/utils/fileEvents';
import {
	contentChecksum,
	describeImportedSource,
	withMovedImportedFiles,
	withoutImportedFiles,
} from '@src/utils/importedFiles';

const entry = (url: string): ImportedFile => ({
	source: { kind: 'url', url },
	checksum: 'x',
	importedAt: 1,
});

describe('files imported from another project or a URL', () => {
	const files = {
		'/refs.bib': entry('https://a.org/refs.bib'),
		'/biblio/a.bib': entry('https://a.org/a.bib'),
		'/biblio2/b.bib': entry('https://a.org/b.bib'),
	};

	it('keep their source when they or their folder move', () => {
		expect(
			Object.keys(withMovedImportedFiles(files, '/refs.bib', '/main.bib')),
		).toEqual(['/main.bib', '/biblio/a.bib', '/biblio2/b.bib']);
		expect(
			withMovedImportedFiles(files, '/biblio', '/sources')['/sources/a.bib'],
		).toBe(files['/biblio/a.bib']);
		expect(
			Object.keys(withMovedImportedFiles(files, '/biblio', '/sources')),
		).toContain('/biblio2/b.bib');
	});

	it('forget it when they or their folder are deleted', () => {
		expect(Object.keys(withoutImportedFiles(files, ['/biblio']))).toEqual([
			'/refs.bib',
			'/biblio2/b.bib',
		]);
		expect(withoutImportedFiles(files, ['/refs.bib', '/biblio2'])).toEqual({
			'/biblio/a.bib': files['/biblio/a.bib'],
		});
		expect(isAtOrUnder('/biblio2/b.bib', '/biblio')).toBe(false);
	});

	it('say where they came from', () => {
		expect(
			describeImportedSource({
				kind: 'url',
				url: 'https://raw.githubusercontent.com/u/r/main/refs.bib?x=1',
			}),
		).toBe('raw.githubusercontent.com/u/r/main/refs.bib');
		expect(
			describeImportedSource({
				kind: 'project',
				projectId: 'p',
				projectName: 'Thèse',
				path: '/biblio/refs.bib',
			}),
		).toBe('Thèse (biblio/refs.bib)');
	});

	it('tell their content by its SHA-256', async () => {
		// The test setup stubs WebCrypto; this one needs the real digest.
		const { webcrypto } = await import('node:crypto');
		(crypto.subtle.digest as jest.Mock).mockImplementation(
			(algorithm: string, data: BufferSource) =>
				webcrypto.subtle.digest(algorithm, data),
		);
		const abc =
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
		expect(await contentChecksum('abc')).toBe(abc);
		expect(
			await contentChecksum(new TextEncoder().encode('abc').buffer),
		).toBe(abc);
	});
});
