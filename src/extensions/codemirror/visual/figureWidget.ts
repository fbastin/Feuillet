// src/extensions/codemirror/visual/figureWidget.ts
// Figures in the visual editor, as Overleaf's figure toolbar edits them: a
// click on the image selects its figure, and a small toolbar, shown also
// while the cursor is in the figure, edits its width, caption and label,
// replaces its image or deletes it. Each edit is read again from the
// document at that moment, and undone on its own.
import { isolateHistory } from '@codemirror/commands';
import { StateEffect, StateField } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';

import { t } from '@/i18n';
import { requestFigureDialog } from '../../../utils/latexFigureUtils';
import { separateUndoStep } from '../undoSteps';
import {
	type FigureChange,
	type LatexFigure,
	deleteFigure,
	findFigureAt,
} from './latexFigure';

/** The selected figure, known by where it starts. */
export const selectFigure = StateEffect.define<number | null>();

export const figureSelectionField = StateField.define<number | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(selectFigure)) return effect.value;
		}
		if (value === null) return value;
		// Moving the cursor in the text leaves the figure.
		if (tr.selection) return null;
		return tr.docChanged ? tr.changes.mapPos(value, 1) : value;
	},
});

/** Keys go to the selected figure, as soon as it is drawn. */
export const focusFigure = (view: EditorView): boolean => {
	const frame = view.dom.querySelector<HTMLElement>(
		'.cm-visual-figure[data-selected="true"]',
	);
	if (!frame) return false;
	if (document.activeElement !== frame) frame.focus({ preventScroll: true });
	return true;
};

/**
 * Changes a figure, as an undo step of its own, and keeps it selected, or
 * puts the cursor at `cursor` once it is gone.
 */
export const applyFigureChanges = (
	view: EditorView,
	changes: FigureChange[],
	selected: number | null,
	cursor?: number,
): void => {
	if (changes.length === 0) {
		view.dispatch({ effects: selectFigure.of(selected) });
		if (selected === null || !focusFigure(view)) view.focus();
		return;
	}
	const set = view.state.changes(changes);
	separateUndoStep(view);
	view.dispatch({
		changes: set,
		effects: selectFigure.of(selected === null ? null : set.mapPos(selected)),
		...(cursor === undefined ? {} : { selection: { anchor: cursor } }),
		annotations: isolateHistory.of('full'),
		userEvent: 'input',
	});
	separateUndoStep(view);
	if (selected === null || !focusFigure(view)) view.focus();
};

type Action = 'edit' | 'replace' | 'delete' | 'latex';

// The figure a widget stands in, as the document has it now.
const figureOf = (view: EditorView, dom: HTMLElement): LatexFigure | null =>
	findFigureAt(view.state.doc.toString(), view.posAtDOM(dom));

const run = (view: EditorView, dom: HTMLElement, action: Action) => {
	const figure = figureOf(view, dom);
	if (!figure) return;
	switch (action) {
		case 'edit':
		case 'replace':
			view.dispatch({ effects: selectFigure.of(figure.from) });
			requestFigureDialog(view, action);
			return;
		case 'delete': {
			const change = deleteFigure(view.state.doc.toString(), figure);
			applyFigureChanges(view, [change], null, change.from);
			return;
		}
		case 'latex':
			// The cursor on the image shows its LaTeX.
			view.dispatch({
				selection: { anchor: figure.graphics.from },
				effects: selectFigure.of(null),
			});
			view.focus();
	}
};

const button = (label: string, title: string, action: Action) => {
	const element = document.createElement('button');
	element.type = 'button';
	element.textContent = label;
	element.title = title;
	element.setAttribute('aria-label', title);
	element.dataset.action = action;
	return element;
};

export interface FigureState {
	selected: boolean;
	toolbar: boolean;
}

/**
 * Shows a figure as selected, and its toolbar. The toolbar lies over the
 * top of the image, so that showing it moves nothing, not even under a
 * click in the caption.
 */
export const setFigureState = (
	frame: HTMLElement,
	{ selected, toolbar }: FigureState,
): void => {
	frame.dataset.selected = String(selected);
	const bar = frame.querySelector<HTMLElement>('.cm-visual-figure-toolbar');
	if (bar) bar.hidden = !toolbar;
};

/** The image of a figure, with its toolbar. */
export const figureFrame = (
	view: EditorView,
	image: HTMLElement,
	state: FigureState,
): HTMLElement => {
	const frame = document.createElement('div');
	frame.className = 'cm-visual-figure';
	frame.dataset.role = 'visual-figure';
	frame.tabIndex = -1;

	const bar = document.createElement('div');
	bar.className = 'cm-visual-figure-toolbar';
	bar.dataset.role = 'visual-figure-toolbar';
	bar.append(
		button(t('Edit'), t('Edit figure'), 'edit'),
		button(t('Replace'), t('Replace image'), 'replace'),
		button(t('Delete'), t('Delete figure'), 'delete'),
		button(t('LaTeX'), t('Edit the LaTeX of the figure'), 'latex'),
	);
	bar.addEventListener('mousedown', (event) => event.preventDefault());
	bar.addEventListener('click', (event) => {
		const target = (event.target as HTMLElement).closest('button');
		if (target?.dataset.action) {
			run(view, frame, target.dataset.action as Action);
		}
	});
	frame.append(bar, image);
	setFigureState(frame, state);

	image.addEventListener('mousedown', (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const figure = figureOf(view, frame);
		if (!figure) return;
		view.dispatch({ effects: selectFigure.of(figure.from) });
		focusFigure(view);
	});
	image.addEventListener('dblclick', () => run(view, frame, 'edit'));

	frame.addEventListener('keydown', (event) => {
		if (event.target !== frame || frame.dataset.selected !== 'true') return;
		if (event.ctrlKey || event.metaKey || event.altKey) {
			// Undo, compile and the other shortcuts, as in the text.
			if (runScopeHandlers(view, event, 'editor')) event.preventDefault();
			return;
		}
		switch (event.key) {
			case 'Backspace':
			case 'Delete':
				event.preventDefault();
				return run(view, frame, 'delete');
			case 'Enter':
				event.preventDefault();
				return run(view, frame, 'edit');
			case 'Escape':
				event.preventDefault();
				view.dispatch({ effects: selectFigure.of(null) });
				view.focus();
		}
	});
	return frame;
};
