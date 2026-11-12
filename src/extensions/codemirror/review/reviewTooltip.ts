// src/extensions/codemirror/review/reviewTooltip.ts
// The tracked change at the cursor, as on Overleaf: its card is highlighted
// in the Changes panel, and those who may decide get « Accept » and
// « Reject » just above it, without going through the panel. Typing hides
// it, so that one's own tracked writing is not covered. A selection over
// several changes gets « Accept (3) » and « Reject (3) » under it, for all
// of them at once, as Overleaf's review panel offers.
import {
	type EditorState,
	type Extension,
	StateField,
	type Transaction,
} from '@codemirror/state';
import {
	type EditorView,
	type Tooltip,
	type TooltipView,
	ViewPlugin,
	showTooltip,
} from '@codemirror/view';

import { t } from '@/i18n';
import type { ReviewChunk } from './reviewDecorations';
import type { ReviewConfig } from './trackChanges';

export interface ActiveChange {
	id: string;
	pos: number;
	user: string;
}

/** The active changes a selection touches, beyond a single one. */
export interface SelectedChanges {
	ids: string[];
	/** The selection's end: the bar goes under it. */
	pos: number;
}

interface ReviewTooltipOptions {
	chunks: StateField<ReviewChunk[]>;
	config: StateField<ReviewConfig>;
	accept: (view: EditorView, id: string) => boolean;
	reject: (view: EditorView, id: string) => boolean;
	/** Several at once, as one step. */
	decide: (
		view: EditorView,
		ids: readonly string[],
		accept: boolean,
	) => boolean;
}

/** The innermost change holding `pos`; a deletion alone holds its ends. */
export function changeAt(
	chunks: readonly ReviewChunk[],
	pos: number,
): ReviewChunk | null {
	let found: ReviewChunk | null = null;
	for (const chunk of chunks) {
		const deletionOnly = chunk.openEnd === chunk.closeStart;
		const inside = deletionOnly
			? pos >= chunk.openStart && pos <= chunk.closeEnd
			: pos > chunk.openStart && pos < chunk.closeEnd;
		if (inside && (!found || chunk.openStart >= found.openStart)) {
			found = chunk;
		}
	}
	return found;
}

const typing = (tr: Transaction) =>
	tr.isUserEvent('input') ||
	tr.isUserEvent('delete') ||
	tr.isUserEvent('undo') ||
	tr.isUserEvent('redo') ||
	tr.isUserEvent('move');

/** The active changes the selection `from`–`to` touches, in order. */
export function changesIn(
	chunks: readonly ReviewChunk[],
	from: number,
	to: number,
): ReviewChunk[] {
	return chunks.filter(
		(chunk) => !chunk.resolved && chunk.openStart < to && chunk.closeEnd > from,
	);
}

export function createReviewTooltip({
	chunks,
	config,
	accept,
	reject,
	decide,
}: ReviewTooltipOptions): Extension {
	const locate = (
		state: EditorState,
		previous: ActiveChange | null,
	): ActiveChange | null => {
		const selection = state.selection.main;
		const chunk = changeAt(state.field(chunks), selection.head);
		if (!chunk) return null;
		if (
			!selection.empty &&
			(selection.from < chunk.openStart || selection.to > chunk.closeEnd)
		) {
			return null;
		}
		const pos = chunk.openStart;
		return previous &&
			previous.id === chunk.id &&
			previous.pos === pos &&
			previous.user === chunk.user
			? previous
			: { id: chunk.id, pos, user: chunk.user };
	};

	const activeChange = StateField.define<ActiveChange | null>({
		create: () => null,
		update(value, tr) {
			if (tr.docChanged && typing(tr)) return null;
			// Moved to: by a click or the arrows.
			if (tr.selection) return locate(tr.state, value);
			// Changed under it: accepted, rejected, or edited by someone else.
			if (tr.docChanged && value) return locate(tr.state, value);
			return value;
		},
	});

	const select = (
		state: EditorState,
		previous: SelectedChanges | null,
	): SelectedChanges | null => {
		const selection = state.selection.main;
		// Inside one change: its own bar.
		if (selection.empty || state.field(activeChange)) return null;
		const ids = changesIn(
			state.field(chunks),
			selection.from,
			selection.to,
		).map((chunk) => chunk.id);
		if (ids.length === 0) return null;
		return previous &&
			previous.pos === selection.to &&
			previous.ids.join() === ids.join()
			? previous
			: { ids, pos: selection.to };
	};

	const selectedChanges = StateField.define<SelectedChanges | null>({
		create: () => null,
		update(value, tr) {
			if (tr.docChanged && typing(tr)) return null;
			if (tr.selection || (tr.docChanged && value))
				return select(tr.state, value);
			return value;
		},
	});

	const tooltip = showTooltip.compute(
		[activeChange, selectedChanges, config],
		(state): Tooltip | null => {
			if (!state.field(config).canDecide) return null;
			const change = state.field(activeChange);
			if (change)
				return {
					pos: change.pos,
					above: true,
					arrow: false,
					create: (view) => decisionBar(view, change, accept, reject),
				};
			const selected = state.field(selectedChanges);
			if (!selected) return null;
			return {
				pos: selected.pos,
				above: false,
				arrow: false,
				create: (view) => selectionBar(view, selected, decide),
			};
		},
	);

	// The panel highlights the card of the change at the cursor.
	const reporter = ViewPlugin.define((view) => {
		let reported: string | null = null;
		const report = (state: EditorState) => {
			const id = state.field(activeChange)?.id ?? null;
			if (id === reported) return;
			reported = id;
			document.dispatchEvent(
				new CustomEvent('review-active', { detail: { reviewId: id } }),
			);
		};
		report(view.state);
		return {
			update: (update) => report(update.state),
			destroy: () => {
				if (reported === null) return;
				document.dispatchEvent(
					new CustomEvent('review-active', { detail: { reviewId: null } }),
				);
			},
		};
	});

	return [activeChange, selectedChanges, tooltip, reporter];
}

function barButton(
	view: EditorView,
	action: string,
	mark: string,
	label: string,
	run: () => boolean,
): HTMLButtonElement {
	const element = document.createElement('button');
	element.type = 'button';
	element.className = 'cm-review-tooltip-button';
	element.dataset.action = action;
	const sign = document.createElement('span');
	sign.setAttribute('aria-hidden', 'true');
	sign.textContent = mark;
	element.append(sign, label);
	// The editor keeps its focus and its cursor.
	element.addEventListener('mousedown', (event) => event.preventDefault());
	element.addEventListener('click', () => {
		run();
		view.focus();
	});
	return element;
}

function selectionBar(
	view: EditorView,
	selected: SelectedChanges,
	decide: ReviewTooltipOptions['decide'],
): TooltipView {
	const dom = document.createElement('div');
	dom.className = 'cm-review-tooltip';
	dom.setAttribute('role', 'toolbar');
	dom.setAttribute('aria-label', t('Tracked changes in the selection'));
	dom.dataset.role = 'review-selection-tooltip';
	const count = selected.ids.length;
	const accept = barButton(
		view,
		'accept-selected',
		'✓',
		`${t('Accept')} (${count})`,
		() => decide(view, selected.ids, true),
	);
	const reject = barButton(
		view,
		'reject-selected',
		'✕',
		`${t('Reject')} (${count})`,
		() => decide(view, selected.ids, false),
	);
	accept.title =
		count === 1
			? t('Accept the change in the selection')
			: t('Accept the {number} changes in the selection', { number: count });
	reject.title =
		count === 1
			? t('Reject the change in the selection')
			: t('Reject the {number} changes in the selection', { number: count });
	dom.append(accept, reject);
	return { dom };
}

function decisionBar(
	view: EditorView,
	change: ActiveChange,
	accept: ReviewTooltipOptions['accept'],
	reject: ReviewTooltipOptions['reject'],
): TooltipView {
	const dom = document.createElement('div');
	dom.className = 'cm-review-tooltip';
	dom.setAttribute('role', 'toolbar');
	dom.setAttribute('aria-label', t('Tracked change'));
	dom.dataset.role = 'review-tooltip';
	dom.dataset.reviewId = change.id;

	// Who made it is on its card, and in the bar's hint: the bar stays
	// narrow enough for an editor squeezed between panels.
	dom.title = t('Change by {user}', { user: change.user });

	dom.append(
		barButton(view, 'accept-change', '✓', t('Accept'), () =>
			accept(view, change.id),
		),
		barButton(view, 'reject-change', '✕', t('Reject'), () =>
			reject(view, change.id),
		),
	);
	return { dom };
}
