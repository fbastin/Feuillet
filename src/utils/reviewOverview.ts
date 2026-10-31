// src/utils/reviewOverview.ts
// The comments and tracked changes of every file of the project, grouped by
// file, as Overleaf's review panel overview.
import { commentService } from '../services/CommentService';
import { reviewService } from '../services/ReviewService';
import { cleanText } from './fileCommentUtils';

export type ChangeKind = 'inserted' | 'deleted' | 'replaced';

export interface ReviewOverviewItem {
	kind: 'comment' | 'change';
	id: string;
	line: number;
	user: string;
	timestamp: number;
	resolved: boolean;
	replies: number;
	/** A comment's text. */
	content?: string;
	/** The text a comment is about. */
	quoted?: string;
	change?: ChangeKind;
	removed?: string;
	added?: string;
}

export interface ReviewOverviewFile {
	path: string;
	fileId: string;
	documentId?: string;
	items: ReviewOverviewItem[];
}

/** A file's comments and tracked changes, in the order of the text. */
export function reviewItemsOf(text: string): ReviewOverviewItem[] {
	if (!text.includes('<###')) return [];
	const comments = commentService.parseComments(text).map(
		(comment): ReviewOverviewItem => ({
			kind: 'comment',
			id: comment.id,
			line: comment.line ?? 1,
			user: comment.user,
			timestamp: comment.timestamp,
			resolved: comment.resolved,
			replies: comment.responses.length,
			content: comment.content,
			quoted: cleanText(comment.commentedText ?? ''),
		}),
	);
	const changes = reviewService
		.parseReviews(text)
		.map((review): ReviewOverviewItem => {
			const removed = review.originalText;
			const added = cleanText(review.currentText);
			return {
				kind: 'change',
				id: review.id,
				line: review.line,
				user: review.user,
				timestamp: review.timestamp,
				resolved: review.resolved,
				replies: review.responses.length,
				change:
					removed && added ? 'replaced' : removed ? 'deleted' : 'inserted',
				removed,
				added,
			};
		});
	return [...comments, ...changes].sort(
		(a, b) => a.line - b.line || a.timestamp - b.timestamp,
	);
}

/** Only the active items, or only the resolved ones, of files having any. */
export function filterOverview(
	files: ReviewOverviewFile[],
	resolved: boolean,
): ReviewOverviewFile[] {
	return files
		.map((file) => ({
			...file,
			items: file.items.filter((item) => item.resolved === resolved),
		}))
		.filter((file) => file.items.length > 0);
}
