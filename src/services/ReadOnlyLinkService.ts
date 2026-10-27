// src/services/ReadOnlyLinkService.ts
import { t } from '@/i18n';
import { isReadOnlyProjectId } from '../utils/urlUtils';

/**
 * Asks the collaboration server for the project's read-only link: whoever
 * opens it receives the project, and the server drops their changes. The
 * same link comes back each time, unless `reset` replaces it, which makes the
 * previous one stop working.
 */
export const requestReadOnlyProjectId = async (
	baseUrl: string,
	projectId: string,
	reset = false,
): Promise<string> => {
	const response = await fetch(`${baseUrl}/share/view`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(
			reset ? { project: projectId, reset } : { project: projectId },
		),
	});
	const view = response.ok ? (await response.json())?.view : undefined;
	if (typeof view !== 'string' || !isReadOnlyProjectId(view)) {
		throw new Error(
			t('Could not get a read-only link from the collaboration server.'),
		);
	}
	return view;
};
