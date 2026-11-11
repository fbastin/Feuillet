import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
	insertText,
	wrapSelection,
} from '@src/extensions/codemirror/toolbar/helpers';
import {
	addsSelectionRange,
	selectPreviousOccurrence,
} from '@src/extensions/codemirror/multipleSelections';

const make = (doc: string, ranges: Array<[number, number]>) =>
	new EditorView({
		state: EditorState.create({
			doc,
			selection: EditorSelection.create(
				ranges.map(([anchor, head]) => EditorSelection.range(anchor, head)),
			),
			extensions: [EditorState.allowMultipleSelections.of(true)],
		}),
		parent: document.body,
	});

describe('toolbar commands with several selections', () => {
	it('wraps each selection and keeps them all selected', () => {
		const view = make('un deux trois', [
			[0, 2],
			[8, 13],
		]);
		wrapSelection(view, '\\textbf{', '}');
		expect(view.state.doc.toString()).toBe('\\textbf{un} deux \\textbf{trois}');
		expect(
			view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)),
		).toEqual(['un', 'trois']);
		view.destroy();
	});

	it('wraps an empty cursor, leaving the cursor between the braces', () => {
		const view = make('a b', [
			[1, 1],
			[3, 3],
		]);
		wrapSelection(view, '\\emph{', '}');
		expect(view.state.doc.toString()).toBe('a\\emph{} b\\emph{}');
		expect(view.state.selection.ranges.map((r) => r.head)).toEqual([7, 16]);
		view.destroy();
	});

	it('inserts at each cursor, with the offset', () => {
		const view = make('x y', [
			[1, 1],
			[3, 3],
		]);
		insertText(view, '\\cite{}', -1);
		expect(view.state.doc.toString()).toBe('x\\cite{} y\\cite{}');
		expect(view.state.selection.ranges.map((r) => r.head)).toEqual([7, 16]);
		view.destroy();
	});

	it('does as before with one selection', () => {
		const view = make('mot', [[0, 3]]);
		wrapSelection(view, '\\textit{', '}');
		expect(view.state.doc.toString()).toBe('\\textit{mot}');
		expect(view.state.selection.main.from).toBe(8);
		expect(view.state.selection.main.to).toBe(11);
		view.destroy();
	});
});

describe('Ctrl+click', () => {
	const click = (init: MouseEventInit, target: Element) => {
		const event = new MouseEvent('mousedown', init);
		Object.defineProperty(event, 'target', { value: target });
		return event;
	};

	it('adds a cursor, but not on a link it follows', () => {
		const text = document.createElement('span');
		const link = document.createElement('span');
		link.className = 'cm-link-hover';
		const inLink = document.createElement('span');
		link.appendChild(inLink);
		expect(addsSelectionRange(click({ ctrlKey: true }, text))).toBe(true);
		expect(addsSelectionRange(click({}, text))).toBe(false);
		expect(addsSelectionRange(click({ ctrlKey: true }, inLink))).toBe(false);
	});
});

describe('the previous occurrence (Ctrl+Alt+←)', () => {
	const run = (view: EditorView) =>
		selectPreviousOccurrence({
			state: view.state,
			dispatch: (tr) => view.dispatch(tr),
		});
	const selected = (view: EditorView) =>
		view.state.selection.ranges.map((r) => [r.from, r.to]);

	it('selects the word first, then adds the previous whole words', () => {
		// a=0 alpha=2 alphabet=8 alpha=17 alpha=23
		const view = make('a alpha alphabet alpha alpha', [[20, 20]]);
		run(view);
		expect(selected(view)).toEqual([[17, 22]]);
		run(view);
		expect(selected(view)).toEqual([
			[2, 7],
			[17, 22],
		]);
		// Before the first: around to the last of the document.
		run(view);
		expect(selected(view)).toEqual([
			[2, 7],
			[17, 22],
			[23, 28],
		]);
		expect(run(view)).toBe(false);
		view.destroy();
	});

	it('matches any text when the selection is not a whole word', () => {
		const view = make('xab ab xab', [[8, 10]]);
		run(view);
		expect(selected(view)).toEqual([
			[4, 6],
			[8, 10],
		]);
		run(view);
		expect(selected(view)).toEqual([
			[1, 3],
			[4, 6],
			[8, 10],
		]);
		view.destroy();
	});

	it('does nothing when the selections differ', () => {
		const view = make('un deux un', [
			[0, 2],
			[3, 7],
		]);
		expect(run(view)).toBe(false);
		view.destroy();
	});
});

