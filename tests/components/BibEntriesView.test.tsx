import { fireEvent, render, screen } from '@testing-library/react';
import BibEntriesView, {
	type BibEdit,
} from '@extras/viewers/bibtex/BibEntriesView';
import { applyBibChanges } from '@src/utils/bibDocument';

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
});
