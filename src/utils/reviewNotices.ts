// src/utils/reviewNotices.ts
// After writing a comment or a reply, the page asks the collaboration server
// to tell the comment's thread by email, and those it mentions (@name): the
// server reads the document itself (server/collab/reviewNotices.js). A few
// seconds later, for the document to have reached it.
import i18next from '@/i18n';
import { accountSyncService } from '../services/AccountSyncService';
import { fileStoreService } from '../services/FileStoreService';
import { projectLinkService } from '../services/ProjectLinkService';

export const REVIEW_NOTICE_DELAY_MS = 4000;

export function tellReview(
	commentId: string,
	{ reply = false }: { reply?: boolean } = {},
): void {
	if (!commentId || !accountSyncService.isLinked()) return;
	const projectId = fileStoreService.getCurrentProjectId();
	if (!projectId) return;
	const project = projectLinkService.serverId(projectId);
	window.setTimeout(() => {
		void accountSyncService
			.notifyReview({
				project,
				comment: commentId,
				reply,
				language: i18next.language,
			})
			.catch(() => {
				// Offline, or an older server: the thread is not mailed.
			});
	}, REVIEW_NOTICE_DELAY_MS);
}
