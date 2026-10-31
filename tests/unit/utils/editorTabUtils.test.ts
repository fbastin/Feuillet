import type { EditorTab } from '@src/types/editorTabs';
import { withMovedTabs } from '@src/utils/editorTabUtils';

const tab = (overrides: Partial<EditorTab>): EditorTab => ({
	id: 't',
	title: '',
	type: 'file',
	lastAccessed: 1,
	editorState: {},
	...overrides,
});

describe('editor tabs of moved files', () => {
	it('follow a renamed file, under its new name and id', () => {
		const tabs = [
			tab({ title: 'refs.bib', fileId: 'a', filePath: '/refs.bib' }),
			tab({
				type: 'document',
				title: '/licence.txt',
				documentId: 'd',
				filePath: '/licence.txt',
			}),
		];

		expect(
			withMovedTabs(tabs, { from: '/refs.bib', to: '/biblio.bib', ids: { a: 'b' } })[0],
		).toMatchObject({ title: 'biblio.bib', fileId: 'b', filePath: '/biblio.bib' });
		expect(
			withMovedTabs(tabs, { from: '/licence.txt', to: '/LICENSE.txt' })[1],
		).toMatchObject({ title: '/LICENSE.txt', filePath: '/LICENSE.txt' });
	});

	it('follow their folder, and leave the others alone', () => {
		const tabs = [
			tab({ title: 'a.tex', fileId: 'a', filePath: '/ch/a.tex' }),
			tab({ title: 'b.tex', fileId: 'b', filePath: '/ch2/b.tex' }),
		];
		const moved = withMovedTabs(tabs, {
			from: '/ch',
			to: '/chapitres',
			ids: { a: 'a2' },
		});

		expect(moved[0]).toMatchObject({ fileId: 'a2', filePath: '/chapitres/a.tex' });
		expect(moved[1]).toBe(tabs[1]);
		expect(withMovedTabs(tabs, { from: '/x', to: '/y' })).toBe(tabs);
	});
});
