// src/utils/fileImportUtils.ts
// Names and messages for files added from another project or from a URL, as
// Overleaf's "From another project" and "From external URL".
import { t } from '@/i18n';

export const isWebAddress = (value: string): boolean => {
	try {
		return /^https?:$/.test(new URL(value.trim()).protocol);
	} catch {
		return false;
	}
};

/** The last segment of a URL's path, as Overleaf names a fetched file. */
export function fileNameFromUrl(value: string): string {
	let segment: string;
	try {
		segment =
			new URL(value.trim()).pathname.split('/').filter(Boolean).pop() ?? '';
	} catch {
		return '';
	}
	try {
		segment = decodeURIComponent(segment);
	} catch {}
	// biome-ignore lint/suspicious/noControlCharactersInRegex: replaces them.
	return segment.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
}

export const fileNameOf = (path: string): string =>
	path.split('/').pop() ?? path;

/** What to tell someone whose file the collaboration server did not fetch. */
export function urlFetchErrorMessage(code: string, status?: number): string {
	switch (code) {
		case 'invalid_url':
			return t('Enter a web address that starts with http:// or https://.');
		case 'blocked_port':
			return t(
				'Files can only be fetched from the usual http and https ports.',
			);
		case 'blocked_address':
			return t('Files cannot be fetched from local or private addresses.');
		case 'unknown_host':
			return t('This site could not be found.');
		case 'upstream_status':
			return status
				? t('The site answered with error {status}.', { status })
				: t('The site did not send the file.');
		case 'too_large':
			return t('This file is too large to add to the project.');
		case 'timeout':
			return t('The site took too long to send the file.');
		case 'too_many_fetches':
			return t('Too many files fetched; try again in a few minutes.');
		case 'busy':
			return t('The server is busy; try again in a moment.');
		case 'signed_out':
			return t('Sign in to your server account again to fetch files.');
		default:
			return t('The file could not be downloaded.');
	}
}

/**
 * A name for another project's PDF, after the project, without accents or
 * spaces, which \includegraphics does not always take.
 */
export function outputFileName(projectName: string): string {
	const base = projectName
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^[-.]+|-+$/g, '');
	return `${base || 'output'}.pdf`;
}
