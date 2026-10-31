// src/extensions/codemirror/review/reviewTooltip.ts
// The tracked change at the cursor, as on Overleaf: its card is highlighted
// in the Changes panel, and those who may decide get « Accept » and
// « Reject » just above it, without going through the panel. Typing hides
// it, so that one's own tracked writing is not covered.
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

interface ReviewTooltipOptions {
	chunks: StateField<ReviewChunk[]>;
	config: StateField<ReviewConfig>;
	accept: (view: EditorView, id: string) => boolean;
	reject: (view: EditorView, id: string) => boolean;
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

export function createReviewTooltip({
	chunks,
	config,
	accept,
	reject,
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

	const tooltip = showTooltip.compute(
		[activeChange, config],
		(state): Tooltip | null => {
			const change = state.field(activeChange);
			if (!change || !state.field(config).canDecide) return null;
			return {
				pos: change.pos,
				above: true,
				arrow: false,
				create: (view) => decisionBar(view, change, accept, reject),
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

	return [activeChange, tooltip, reporter];
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

	const button = (
		action: string,
		mark: string,
		label: string,
		run: () => boolean,
	) => {
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
	};

	dom.append(
		button('accept-change', '✓', t('Accept'), () => accept(view, change.id)),
		button('reject-change', '✕', t('Reject'), () => reject(view, change.id)),
	);
	return { dom };
}
