import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
	overleafEditorKeys,
	toLowerCase,
	toUpperCase,
} from '@src/extensions/codemirror/overleafKeys';

const make = (
	doc: string,
	ranges: Array<[number, number]>,
	readOnly = false,
) =>
	new EditorView({
		state: EditorState.create({
			doc,
			selection: EditorSelection.create(
				ranges.map(([anchor, head]) => EditorSelection.range(anchor, head)),
			),
			extensions: [
				EditorState.allowMultipleSelections.of(true),
				EditorState.readOnly.of(readOnly),
			],
		}),
		parent: document.body,
	});
const run = (command: typeof toUpperCase, view: EditorView) =>
	command({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
const ranges = (view: EditorView) =>
	view.state.selection.ranges.map((r) => [r.anchor, r.head]);

describe('Ctrl+U and Ctrl+Shift+U', () => {
	it('put the selection in upper case, still selected the same way', () => {
		const view = make('un deux trois', [[7, 3]]);
		expect(run(toUpperCase, view)).toBe(true);
		expect(view.state.doc.toString()).toBe('un DEUX trois');
		expect(ranges(view)).toEqual([[7, 3]]);
		view.destroy();
	});

	it('take the word at a cursor, and leave the cursor where it was', () => {
		const view = make('Théorème de Pythagore', [[3, 3]]);
		run(toUpperCase, view);
		expect(view.state.doc.toString()).toBe('THÉORÈME de Pythagore');
		expect(ranges(view)).toEqual([[3, 3]]);
		run(toLowerCase, view);
		expect(view.state.doc.toString()).toBe('théorème de Pythagore');
		view.destroy();
	});

	it('act at every cursor', () => {
		const view = make('alpha beta gamma', [
			[0, 5],
			[11, 11],
		]);
		run(toUpperCase, view);
		expect(view.state.doc.toString()).toBe('ALPHA beta GAMMA');
		view.destroy();
	});

	it('select the new text when its length changes', () => {
		const view = make('straße', [[0, 6]]);
		run(toUpperCase, view);
		expect(view.state.doc.toString()).toBe('STRASSE');
		expect(ranges(view)).toEqual([[0, 7]]);
		view.destroy();
	});

	it('change nothing in a read-only file, or when already so', () => {
		const readOnly = make('mot', [[0, 3]], true);
		expect(run(toUpperCase, readOnly)).toBe(false);
		expect(readOnly.state.doc.toString()).toBe('mot');
		readOnly.destroy();
		const upper = make('MOT', [[0, 3]]);
		expect(run(toUpperCase, upper)).toBe(false);
		upper.destroy();
	});
});

describe('the keys', () => {
	const keys = (reviews: boolean) =>
		overleafEditorKeys({ reviews }).map((binding) => binding.key);

	it('toggle the review panel and tracking only with reviews', () => {
		expect(keys(true)).toEqual([
			'Mod-u',
			'Mod-Shift-u',
			'Mod-Shift-l',
			'Mod-j',
			'Mod-Shift-a',
		]);
		expect(keys(false)).toEqual(['Mod-u', 'Mod-Shift-u', 'Mod-Shift-l']);
	});

	const press = (view: EditorView, key: string) =>
		overleafEditorKeys({ reviews: true })
			.find((binding) => binding.key === key)
			?.run?.(view);

	it('send Ctrl+J and Ctrl+Shift+A to the review panel', () => {
		const heard: string[] = [];
		const listen = (event: Event) => heard.push(event.type);
		document.addEventListener('toggle-review-panel', listen);
		document.addEventListener('toggle-track-changes', listen);
		const view = make('x', [[0, 0]]);
		press(view, 'Mod-j');
		press(view, 'Mod-Shift-a');
		expect(heard).toEqual(['toggle-review-panel', 'toggle-track-changes']);
		// A read-only file: the panel, but not tracking.
		const readOnly = make('x', [[0, 0]], true);
		heard.length = 0;
		press(readOnly, 'Mod-j');
		expect(press(readOnly, 'Mod-Shift-a')).toBe(false);
		expect(heard).toEqual(['toggle-review-panel']);
		document.removeEventListener('toggle-review-panel', listen);
		document.removeEventListener('toggle-track-changes', listen);
		view.destroy();
		readOnly.destroy();
	});
});
