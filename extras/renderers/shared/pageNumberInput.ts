// extras/renderers/shared/pageNumberInput.ts
// The page number in the PDF viewers' toolbar, an <input type=number>. A
// number typed goes to its page on Enter (typing « 12 » must not show page
// 1 first), but its arrows, beside it, and the arrow keys step the page at
// once, as in PDF.js's viewer: the browser only changes the number.
import { useCallback, useRef } from 'react';

/**
 * Tells the changes the input's arrows make, pressed with the pointer: the
 * number changes while it is down (and again while it is held), never as
 * one types.
 */
export const usePageNumberArrows = () => {
	const pressedRef = useRef(false);

	const onPointerDown = useCallback(() => {
		pressedRef.current = true;
		// Released anywhere: the pointer may leave the input first.
		const released = new AbortController();
		const release = () => {
			pressedRef.current = false;
			released.abort();
		};
		window.addEventListener('pointerup', release, { signal: released.signal });
		window.addEventListener('pointercancel', release, {
			signal: released.signal,
		});
	}, []);

	/** The page a change of the number goes to, when the arrows made it. */
	const pageOfChange = useCallback((value: string): number | null => {
		if (!pressedRef.current) return null;
		const page = Number.parseInt(value, 10);
		return Number.isFinite(page) ? page : null;
	}, []);

	return { onPointerDown, pageOfChange };
};

/**
 * The page the up and down arrow keys go to from the number shown (or the
 * current page), within the document; null for another key.
 */
export const steppedPage = (
	key: string,
	shown: string,
	current: number,
	numPages: number,
): number | null => {
	if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;
	const from = Number.parseInt(shown, 10);
	const page =
		(Number.isFinite(from) ? from : current) + (key === 'ArrowUp' ? 1 : -1);
	return Math.min(Math.max(page, 1), Math.max(numPages, 1));
};
