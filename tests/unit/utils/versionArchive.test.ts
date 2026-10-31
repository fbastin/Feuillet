import { commentService } from '@src/services/CommentService';
import {
	versionArchiveEntries,
	versionArchiveName,
} from '@src/utils/versionArchive';

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe('a version of the project as a ZIP', () => {
	const raw = commentService.addComment('Vérifier.', 'alice');
	const contents: Record<string, ArrayBuffer> = {
		doc: bytes(`Un ${raw.openTag}passage${raw.closeTag} commenté.`),
		stale: bytes('Ancienne copie.'),
		bib: bytes('@book{knuth}'),
		png: new Uint8Array([137, 80, 78, 71, 0, 1]).buffer,
		temp: bytes('%PDF'),
	};

	it('holds its files, documents as they were, without the tags', async () => {
		const entries = await versionArchiveEntries(
			{
				docs: [{ id: 'd', path: '/chapitres/intro.tex', hash: 'doc', size: 1 }],
				files: [
					{ path: '/chapitres/intro.tex', hash: 'stale', size: 1 },
					{ path: '/refs.bib', hash: 'bib', size: 1 },
					{ path: '/images/plot.png', hash: 'png', size: 1 },
					{ path: '/.texlyre_src/__output/main.pdf', hash: 'temp', size: 1 },
				],
			},
			async (hash) => contents[hash],
		);

		expect(entries.map((entry) => entry.path)).toEqual([
			'chapitres/intro.tex',
			'images/plot.png',
			'refs.bib',
		]);
		expect(text(entries[0].data)).toBe('Un passage commenté.');
		expect([...entries[1].data]).toEqual([137, 80, 78, 71, 0, 1]);
		expect(text(entries[2].data)).toBe('@book{knuth}');
	});

	it('is named after the project and the version', () => {
		const time = new Date(2026, 9, 31, 8, 5).getTime();
		expect(versionArchiveName('Thèse de doctorat', time)).toBe(
			'These-de-doctorat-2026-10-31-0805.zip',
		);
		expect(versionArchiveName('Thèse', time, 'Soumis au jury')).toBe(
			'These-Soumis-au-jury.zip',
		);
		expect(versionArchiveName('« »', time)).toBe('projet-2026-10-31-0805.zip');
	});
});
