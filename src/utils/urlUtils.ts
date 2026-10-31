// src/utils/urlUtils.ts
import { APP_NAME } from '../branding';
import type { UrlFragments } from '../types/yjs';

const LEGACY_YJS_PROJECT_ID_RE = /^[a-z0-9]{20,32}$/;
const UUID_PROJECT_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// A read-only link to a project, given by the collaboration server: whoever
// opens it receives the project, and the server drops their changes.
const READ_ONLY_PROJECT_ID_RE = /^view[0-9a-f]{32}$/;
// A review link, given by the collaboration server to the reviewers it
// invites: their changes go through only as comments and tracked changes.
const REVIEW_PROJECT_ID_RE = /^review[0-9a-f]{32}$/;

export function isValidYjsProjectId(projectId: string): boolean {
	const value = projectId.trim();

	return (
		LEGACY_YJS_PROJECT_ID_RE.test(value) ||
		UUID_PROJECT_ID_RE.test(value) ||
		READ_ONLY_PROJECT_ID_RE.test(value) ||
		REVIEW_PROJECT_ID_RE.test(value)
	);
}

export function isReadOnlyProjectId(projectId: string): boolean {
	return READ_ONLY_PROJECT_ID_RE.test(projectId);
}

export function isReviewProjectId(projectId: string): boolean {
	return REVIEW_PROJECT_ID_RE.test(projectId);
}

export type ProjectLinkKind = 'edit' | 'review' | 'view';

/** What a link to a project lets do: edit it, review it or read it. */
export function projectLinkKind(projectId: string): ProjectLinkKind {
	if (isReadOnlyProjectId(projectId)) return 'view';
	return isReviewProjectId(projectId) ? 'review' : 'edit';
}

export function isReadOnlyDocUrl(docUrl: string): boolean {
	return docUrl.startsWith('yjs:') && isReadOnlyProjectId(docUrl.slice(4));
}

export function isReviewDocUrl(docUrl: string): boolean {
	return docUrl.startsWith('yjs:') && isReviewProjectId(docUrl.slice(4));
}

export function isValidYjsUrl(url: string): boolean {
	const value = url.trim();

	if (!value.startsWith('yjs:')) return false;
	if (value.includes('&')) return false;

	return isValidYjsProjectId(value.slice(4));
}

export function generateYjsProjectId(): string {
	return crypto.randomUUID();
}

export function parseUrlFragments(url: string): UrlFragments {
	const parts = url.split('&');
	const result: UrlFragments = { yjsUrl: '' };

	for (const part of parts) {
		if (part.startsWith('yjs:')) {
			const candidate = part.trim();
			result.yjsUrl = isValidYjsUrl(candidate) ? candidate : '';
		} else if (part.startsWith('doc:')) {
			result.docId = decodeURIComponent(part.slice(4));
		} else if (part.startsWith('file:')) {
			result.filePath = decodeURIComponent(part.slice(5));
		} else if (part.startsWith('compile:')) {
			result.compile = decodeURIComponent(part.slice(8));
		}
	}

	return result;
}

export function buildUrlWithFragments(
	yjsUrl: string,
	docId?: string,
	filePath?: string,
): string {
	const currentHash = window.location.hash.substring(1);
	const existingFragments = parseUrlFragments(currentHash);

	let url = yjsUrl;
	if (docId) {
		url += `&doc:${encodeURIComponent(docId)}`;
	}
	if (filePath) {
		url += `&file:${encodeURIComponent(filePath)}`;
	}
	if (existingFragments.compile) {
		url += `&compile:${encodeURIComponent(existingFragments.compile)}`;
	}

	return url;
}

export function getProjectName(fallback = APP_NAME): string {
	if (document.title && document.title !== APP_NAME) {
		return document.title;
	}

	const { yjsUrl } = parseUrlFragments(window.location.hash.substring(1));
	if (yjsUrl) {
		return `Project ${yjsUrl.slice(4).substring(0, 8)}`;
	}

	return fallback;
}

export function pushHash(hash: string): void {
	const target = hash
		? `#${hash}`
		: `${window.location.pathname}${window.location.search}`;
	const oldURL = window.location.href;
	window.history.pushState(null, '', target);
	if (window.location.href !== oldURL) {
		window.dispatchEvent(
			new HashChangeEvent('hashchange', {
				oldURL,
				newURL: window.location.href,
			}),
		);
	}
}

export function replaceHash(hash: string): void {
	const target = hash
		? `#${hash}`
		: `${window.location.pathname}${window.location.search}`;
	const oldURL = window.location.href;
	window.history.replaceState(null, '', target);
	if (window.location.href !== oldURL) {
		window.dispatchEvent(
			new HashChangeEvent('hashchange', {
				oldURL,
				newURL: window.location.href,
			}),
		);
	}
}

/** A personal invitation's link, `#invite:<token>`, which joins its project. */
export const inviteUrl = (invite: string): string =>
	`${window.location.origin}${window.location.pathname}#invite:${invite}`;

/** The invitation a location's hash holds, if any. */
export const inviteOf = (hash: string): string | null =>
	/^#?invite:([0-9a-f]{48})$/.exec(hash)?.[1] ?? null;
