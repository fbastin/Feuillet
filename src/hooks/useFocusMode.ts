// src/hooks/useFocusMode.ts
// Focus mode, as Overleaf's (Ctrl/Cmd+Shift+M): the editor and the PDF
// alone, without the project's menu bar, side panels, editor tools and
// footer; compiling stays at hand. Kept for the tab, through a reload.
import { useCallback, useEffect, useState } from 'react';

import { OPEN_SIDEBAR_VIEW } from '../utils/workspaceEvents';

/** Turns focus mode on or off (useGlobalKeyboard: Ctrl/Cmd+Shift+M). */
export const TOGGLE_FOCUS_MODE = 'toggle-focus-mode';

/** Its keys as written on this machine. */
export const FOCUS_MODE_KEYS =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
		? '⇧⌘M'
		: 'Ctrl+Shift+M';

const STORAGE_KEY = 'feuillet-focus-mode';

const stored = (): boolean => {
	try {
		return sessionStorage.getItem(STORAGE_KEY) === 'true';
	} catch {
		return false;
	}
};

export function useFocusMode(): [boolean, (on: boolean) => void] {
	const [focusMode, setFocusModeState] = useState(stored);

	const setFocusMode = useCallback((on: boolean) => {
		setFocusModeState(on);
		try {
			if (on) sessionStorage.setItem(STORAGE_KEY, 'true');
			else sessionStorage.removeItem(STORAGE_KEY);
		} catch {
			// Kept for this page only.
		}
	}, []);

	useEffect(() => {
		const toggle = () => setFocusMode(!stored());
		// A side panel asked for (Ctrl+Shift+F, Ctrl+Shift+H, the command
		// palette) shows again.
		const leave = () => setFocusMode(false);
		document.addEventListener(TOGGLE_FOCUS_MODE, toggle);
		document.addEventListener('open-search-panel', leave);
		document.addEventListener(OPEN_SIDEBAR_VIEW, leave);
		return () => {
			document.removeEventListener(TOGGLE_FOCUS_MODE, toggle);
			document.removeEventListener('open-search-panel', leave);
			document.removeEventListener(OPEN_SIDEBAR_VIEW, leave);
		};
	}, [setFocusMode]);

	return [focusMode, setFocusMode];
}
