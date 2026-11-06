// src/utils/urlProjectLink.ts
// TeXlyre's « #newProjectName:…&newProjectFiles:… » addresses create a
// project at once. Feuillet's own imports (templates, archives from an
// address) go through them after the person chose; such an address coming
// from elsewhere, as a link on another page, asks first (OpenLinkModal).
import type { OpenLinkRequest } from './openLink';

const KEY = 'feuillet-in-app-project-link';

// The fragment as the address bar gives it back.
const normal = (hash: string): string => {
	try {
		return new URL(`http://x/#${hash.replace(/^#/, '')}`).hash.slice(1);
	} catch {
		return hash.replace(/^#/, '');
	}
};

/** An import of this tab is about to open this address. */
export const markInAppProjectLink = (hash: string): void => {
	try {
		sessionStorage.setItem(KEY, normal(hash));
	} catch {}
};

/** Whether this tab's import opened this address; asked once. */
export const takeInAppProjectLink = (hash: string): boolean => {
	try {
		const marked = sessionStorage.getItem(KEY);
		sessionStorage.removeItem(KEY);
		return marked !== null && marked === normal(hash);
	} catch {
		return false;
	}
};

/** What such an address asks, as a link to /docs would. */
export const openLinkRequestOf = (params: {
	newProjectFiles?: string;
}): OpenLinkRequest => ({
	sources:
		params.newProjectFiles && /^(?:https?|data):/i.test(params.newProjectFiles)
			? [{ uri: params.newProjectFiles }]
			: [],
	names: [],
});
