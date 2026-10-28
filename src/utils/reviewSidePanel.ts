// src/utils/reviewSidePanel.ts
// The comments and changes panels share the side of the editor, one at a time.
export type ReviewSidePanel = 'comments' | 'changes';

const PANEL_OPENED = 'review-side-panel-opened';

export const announceReviewSidePanel = (panel: ReviewSidePanel): void => {
	document.dispatchEvent(new CustomEvent(PANEL_OPENED, { detail: { panel } }));
};

/** Calls `onOpened` whenever one of the panels opens; returns how to stop. */
export const onReviewSidePanel = (
	onOpened: (panel: ReviewSidePanel) => void,
): (() => void) => {
	const listener = (event: Event) =>
		onOpened((event as CustomEvent<{ panel: ReviewSidePanel }>).detail.panel);
	document.addEventListener(PANEL_OPENED, listener);
	return () => document.removeEventListener(PANEL_OPENED, listener);
};
