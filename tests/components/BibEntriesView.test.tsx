import { act, fireEvent, render, screen, within } from '@testing-library/react';
import BibEntriesView, {
	type BibEdit,
} from '@extras/viewers/bibtex/BibEntriesView';
import { applyBibChanges } from '@src/utils/bibDocument';
import { collectCitations } from '@src/utils/latexCitations';

const TEXT = `@article{ein05,
  author  = {Einstein, Albert},
  title   = {Zur Elektrodynamik bewegter K{\\"o}rper},
  journal = {Annalen der Physik},
  year    = {1905},
}
`;

// The entries of a .bib as forms: what is typed there is an edit of the
// text, made by the editor; viewers and reviewers only read.
describe('BibEntriesView', () => {
	beforeAll(() => {
		// jsdom lays nothing out.
		Element.prototype.scrollIntoView = jest.fn();
	});

	const view = (readOnly: boolean, onEdit = jest.fn()) =>
		render(
			<BibEntriesView
				text={TEXT}
				active
				readOnly={readOnly}
				chosenDialect={null}
				latexDialect={null}
				onDialectChange={jest.fn()}
				onEdit={onEdit}
				onShowInText={jest.fn()}
			/>,
		);

	it('shows the first entry, its fields and its preview', () => {
		view(false);
		expect(screen.getByDisplayValue('ein05')).toBeInTheDocument();
		expect(screen.getByDisplayValue('Annalen der Physik')).toBeInTheDocument();
		expect(document.querySelector('.bib-preview-text')?.textContent).toContain(
			'Zur Elektrodynamik bewegter Körper',
		);
	});

	it('makes a field’s change an edit of its value only', () => {
		let made = '';
		const onEdit = jest.fn((edit: BibEdit) => {
			made = applyBibChanges(TEXT, edit(TEXT));
		});
		view(false, onEdit);
		const year = screen.getByDisplayValue('1905');
		fireEvent.focus(year);
		fireEvent.change(year, { target: { value: '1906' } });
		fireEvent.keyDown(year, { key: 'Enter' });
		expect(onEdit).toHaveBeenCalledTimes(1);
		expect(made).toBe(TEXT.replace('{1905}', '{1906}'));
	});

	it('lets viewers and reviewers read only', () => {
		const onEdit = jest.fn();
		view(true, onEdit);
		expect(document.querySelector('fieldset.bib-form')).toBeDisabled();
		expect(screen.getByDisplayValue('ein05')).toHaveAttribute('readonly');
		expect(screen.queryByText('New entry')).not.toBeInTheDocument();
		expect(screen.queryByText('Delete')).not.toBeInTheDocument();
		expect(screen.queryByText('Add a field')).not.toBeInTheDocument();
		const year = screen.getByDisplayValue('1905');
		fireEvent.change(year, { target: { value: '1906' } });
		fireEvent.keyDown(year, { key: 'Enter' });
		fireEvent.blur(year);
		expect(onEdit).not.toHaveBeenCalled();
	});

	describe('with the project’s LaTeX files', () => {
		const BIB = `${TEXT}
@book{Knuth84,
  author = {Knuth, Donald},
  title  = {The {\\TeX}book},
  year   = {1984},
}

@book{lamport94,
  author = {Lamport, Leslie},
  title  = {{\\LaTeX}},
  year   = {1994},
}
`;
		const citations = collectCitations([
			{
				path: '/main.tex',
				text: '\\cite{ein05} \\citep{ein05,knuth84} % \\cite{lamport94}',
			},
			{ path: '/chapters/intro.tex', text: '\\parencite{ein05,smith2020}' },
		]);
		const cited = (
			readOnly: boolean,
			onRenameCitations = jest.fn(async () => ({ count: 0, files: [] })),
			onEdit = jest.fn(),
		) =>
			render(
				<BibEntriesView
					text={BIB}
					active
					readOnly={readOnly}
					chosenDialect={null}
					latexDialect={null}
					onDialectChange={jest.fn()}
					onEdit={onEdit}
					onShowInText={jest.fn()}
					citations={citations}
					onRenameCitations={readOnly ? undefined : onRenameCitations}
				/>,
			);
		const rowOf = (key: string) =>
			screen.getAllByRole('row').find((row) =>
				row.querySelector('.bib-cell-key')?.textContent?.includes(key),
			) as HTMLElement;

		it('counts each entry’s citations, not those in comments', () => {
			cited(false);
			expect(screen.getByText('Citations')).toBeInTheDocument();
			expect(rowOf('ein05').querySelector('.bib-cell-cited')).toHaveTextContent(
				'3',
			);
			expect(
				rowOf('ein05').querySelector('.bib-cell-cited'),
			).toHaveAttribute('title', 'main.tex (2), chapters/intro.tex');
			// Cited knuth84: not Knuth84 for biber.
			expect(rowOf('Knuth84').querySelector('.bib-cell-cited')).toHaveTextContent(
				'—',
			);
			expect(
				rowOf('lamport94').querySelector('.bib-cell-cited'),
			).toHaveTextContent('—');
		});

		it('shows the entries cited, or the others', () => {
			cited(false);
			const filter = screen.getByLabelText('Entries to show');
			fireEvent.change(filter, { target: { value: 'uncited' } });
			const keys = [
				...document.querySelectorAll('tbody .bib-cell-key'),
			].map((cell) => cell.textContent);
			expect(keys).toEqual(['Knuth84', 'lamport94']);
			fireEvent.change(filter, { target: { value: 'cited' } });
			expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
		});

		it('lists the keys cited without an entry, to add it or correct them', () => {
			const onRenameCitations = jest.fn(async () => ({
				count: 1,
				files: ['/main.tex'],
			}));
			cited(false, onRenameCitations);
			const missing = document.querySelector('.bib-missing') as HTMLElement;
			const items = within(missing).getAllByRole('listitem');
			expect(items.map((item) => item.querySelector('code')?.textContent)).toEqual(
				['knuth84', 'smith2020'],
			);
			// smith2020: added with that key.
			fireEvent.click(within(items[1]).getByText('Add its entry'));
			expect(
				document.querySelector('.bib-new-entry h4')?.textContent,
			).toContain('smith2020');
			expect(
				document.querySelector<HTMLInputElement>('.bib-new-entry-empty input')
					?.value,
			).toBe('smith2020');
			// knuth84: the file has Knuth84, the citations are corrected.
			expect(items[0]).toHaveTextContent('Knuth84');
			fireEvent.click(within(items[0]).getByText('Correct the citations'));
			expect(onRenameCitations).toHaveBeenCalledWith('knuth84', 'Knuth84');
		});

		it('renames the citations with the key', async () => {
			const onRenameCitations = jest.fn(async () => ({
				count: 3,
				files: ['/main.tex', '/chapters/intro.tex'],
			}));
			const onEdit = jest.fn();
			const { rerender } = cited(false, onRenameCitations, onEdit);
			expect(document.querySelector('.bib-cited-line')).toHaveTextContent(
				'main.tex (2), chapters/intro.tex',
			);
			const keyInput = screen.getByDisplayValue('ein05');
			fireEvent.focus(keyInput);
			fireEvent.change(keyInput, { target: { value: 'einstein1905' } });
			await act(async () => {
				fireEvent.keyDown(keyInput, { key: 'Enter' });
			});
			expect(onEdit).toHaveBeenCalledTimes(1);
			expect(onRenameCitations).toHaveBeenCalledWith('ein05', 'einstein1905');
			// The file renamed: the entry tells how its citations went.
			rerender(
				<BibEntriesView
					text={BIB.replace('{ein05,', '{einstein1905,')}
					active
					readOnly={false}
					chosenDialect={null}
					latexDialect={null}
					onDialectChange={jest.fn()}
					onEdit={onEdit}
					onShowInText={jest.fn()}
					citations={citations}
					onRenameCitations={onRenameCitations}
				/>,
			);
			expect(screen.getByRole('status')).toHaveTextContent('ein05');
			expect(screen.getByRole('status')).toHaveTextContent('chapters/intro.tex');
		});

		it('does not offer to rename an uncited key’s citations', () => {
			const onRenameCitations = jest.fn(async () => ({ count: 0, files: [] }));
			cited(false, onRenameCitations);
			fireEvent.click(rowOf('lamport94'));
			expect(document.querySelector('.bib-cited-line')).toHaveTextContent(
				'Not cited in the LaTeX files',
			);
			expect(screen.queryByRole('checkbox', { name: 'Rename them with the key' }))
				.not.toBeInTheDocument();
			const keyInput = screen.getByDisplayValue('lamport94');
			fireEvent.focus(keyInput);
			fireEvent.change(keyInput, { target: { value: 'lamport1994' } });
			fireEvent.keyDown(keyInput, { key: 'Enter' });
			expect(onRenameCitations).not.toHaveBeenCalled();
		});

		it('renames the key alone when the box is unchecked', () => {
			const onRenameCitations = jest.fn(async () => ({ count: 0, files: [] }));
			const onEdit = jest.fn();
			cited(false, onRenameCitations, onEdit);
			fireEvent.click(
				screen.getByRole('checkbox', { name: 'Rename them with the key' }),
			);
			const keyInput = screen.getByDisplayValue('ein05');
			fireEvent.focus(keyInput);
			fireEvent.change(keyInput, { target: { value: 'einstein1905' } });
			fireEvent.keyDown(keyInput, { key: 'Enter' });
			expect(onEdit).toHaveBeenCalledTimes(1);
			expect(onRenameCitations).not.toHaveBeenCalled();
		});

		it('lets viewers see the citations, not change them', () => {
			cited(true);
			expect(document.querySelector('.bib-cited-line')).toBeInTheDocument();
			expect(
				screen.queryByRole('checkbox', { name: 'Rename them with the key' }),
			).not.toBeInTheDocument();
			expect(screen.queryByText('Add its entry')).not.toBeInTheDocument();
			expect(screen.queryByText('Correct the citations')).not.toBeInTheDocument();
		});

		it('shows nothing of it when the project has no LaTeX file', () => {
			render(
				<BibEntriesView
					text={BIB}
					active
					readOnly={false}
					chosenDialect={null}
					latexDialect={null}
					onDialectChange={jest.fn()}
					onEdit={jest.fn()}
					onShowInText={jest.fn()}
					citations={collectCitations([])}
					onRenameCitations={jest.fn()}
				/>,
			);
			expect(screen.queryByText('Citations')).not.toBeInTheDocument();
			expect(document.querySelector('.bib-cited-line')).not.toBeInTheDocument();
			expect(document.querySelector('.bib-missing')).not.toBeInTheDocument();
		});
	});

	describe('probable duplicates', () => {
		const BIB = `@article{CarlSode98,
  title  = {An experimental comparison of gradient methods in econometric duration analysis},
  author = {Kenneth Carling and Hans S\\"oderberg},
  year   = {1998},
}

@book{knuth1984,
  title = {The {\\TeX}book},
}

@article{KennHans98,
  author  = {Carling, Kenneth and S{\\"o}derberg, Hans},
  title   = {An Experimental Comparison of Gradient Methods in Econometric Duration Analysis},
  year    = {1998},
  pages   = {83--97},
}
`;
		const duplicates = (
			readOnly: boolean,
			props: Partial<React.ComponentProps<typeof BibEntriesView>> = {},
		) =>
			render(
				<BibEntriesView
					text={BIB}
					active
					readOnly={readOnly}
					chosenDialect={null}
					latexDialect={null}
					onDialectChange={jest.fn()}
					onEdit={jest.fn()}
					onShowInText={jest.fn()}
					{...props}
				/>,
			);

		it('marks them, and shows them together', () => {
			duplicates(false);
			const mark = document.querySelector('tbody tr .bib-problem-mark');
			expect(mark?.getAttribute('title')).toContain(
				'Probably the same reference as KennHans98',
			);
			fireEvent.change(screen.getByLabelText('Entries to show'), {
				target: { value: 'duplicates' },
			});
			const keys = [...document.querySelectorAll('tbody .bib-cell-key')].map(
				(cell) => cell.textContent,
			);
			expect(keys).toEqual(['CarlSode98', 'KennHans98']);
		});

		it('merges one into the other, field by field', () => {
			let made = '';
			const onEdit = jest.fn((edit: BibEdit) => {
				made = applyBibChanges(BIB, edit(BIB));
			});
			duplicates(false, { onEdit });
			fireEvent.click(screen.getByText('Compare and merge'));
			const panel = document.querySelector('.bib-merge') as HTMLElement;
			// The title of the other: its capitals.
			const titleRow = within(panel).getByText('title').closest('tr') as HTMLElement;
			fireEvent.click(within(titleRow).getAllByRole('radio')[1]);
			fireEvent.click(within(panel).getByText(/^Merge into/));
			expect(onEdit).toHaveBeenCalledTimes(1);
			expect(made).toBe(`@article{CarlSode98,
  title  = {An Experimental Comparison of Gradient Methods in Econometric Duration Analysis},
  author = {Kenneth Carling and Hans S\\"oderberg},
  year   = {1998},
  pages  = {83--97},
}

@book{knuth1984,
  title = {The {\\TeX}book},
}
`);
			expect(document.querySelector('.bib-merge')).not.toBeInTheDocument();
		});

		it('keeps the other key when asked', () => {
			let made = '';
			const onEdit = jest.fn((edit: BibEdit) => {
				made = applyBibChanges(BIB, edit(BIB));
			});
			duplicates(false, { onEdit });
			fireEvent.click(screen.getByText('Compare and merge'));
			const panel = document.querySelector('.bib-merge') as HTMLElement;
			const header = panel.querySelector('thead tr') as HTMLElement;
			fireEvent.click(within(header).getAllByRole('radio')[1]);
			fireEvent.click(within(panel).getByText(/^Merge into/));
			expect(made.includes('@article{CarlSode98')).toBe(false);
			expect(made.endsWith(`@article{KennHans98,
  author  = {Carling, Kenneth and S{\\"o}derberg, Hans},
  title   = {An Experimental Comparison of Gradient Methods in Econometric Duration Analysis},
  year    = {1998},
  pages   = {83--97},
}
`)).toBe(true);
		});

		it('forgets a pair said not to be the same', () => {
			const onMarkDistinct = jest.fn();
			const { rerender } = duplicates(false, { onMarkDistinct });
			fireEvent.click(screen.getByText('Not the same'));
			expect(onMarkDistinct).toHaveBeenCalledWith('CarlSode98', 'KennHans98');
			rerender(
				<BibEntriesView
					text={BIB}
					active
					readOnly={false}
					chosenDialect={null}
					latexDialect={null}
					onDialectChange={jest.fn()}
					onEdit={jest.fn()}
					onShowInText={jest.fn()}
					distinctPairs={[['KennHans98', 'CarlSode98']]}
					onMarkDistinct={onMarkDistinct}
				/>,
			);
			expect(document.querySelector('.bib-duplicates')).not.toBeInTheDocument();
			for (const mark of document.querySelectorAll('tbody .bib-problem-mark')) {
				expect(mark.getAttribute('title')).not.toContain('Probably');
			}
		});

		it('lets viewers see them, not merge them', () => {
			duplicates(true);
			expect(document.querySelector('.bib-duplicates')).toBeInTheDocument();
			expect(screen.queryByText('Compare and merge')).not.toBeInTheDocument();
		});
	});
});
