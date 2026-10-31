// src/utils/reviewOverview.ts
// The comments and tracked changes of every file of the project, grouped by
// file, as Overleaf's review panel overview.
import { restoreReviewBody } from '../extensions/codemirror/review/reviewSegments';
import { commentService } from '../services/CommentService';
import { reviewService } from '../services/ReviewService';
import type { Review } from '../types/review';
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

// Decisions taken from the overview, on a file's whole text, as the editor
// takes them: accepting keeps the change's text, rejecting puts the original
// back, either way without its tags.

const decided = (text: string, review: Review, accept: boolean): string => {
	const body = text.slice(review.openTagEnd, review.closeTagStart);
	return (
		text.slice(0, review.openTagStart) +
		(accept ? body : restoreReviewBody(body, review.originalText)) +
		text.slice(review.closeTagEnd)
	);
};

/** The text with one tracked change accepted or rejected. */
export function decideChange(
	text: string,
	id: string,
	accept: boolean,
): string {
	const review = reviewService
		.parseReviews(text)
		.find((entry) => entry.id === id);
	return review ? decided(text, review, accept) : text;
}

/** The text with all its active tracked changes accepted or rejected. */
export function decideAllChanges(text: string, accept: boolean): string {
	return reviewService
		.parseReviews(text)
		.filter((review) => !review.resolved)
		.sort((a, b) => b.openTagStart - a.openTagStart)
		.reduce((current, review) => decided(current, review, accept), text);
}

/** The text with a comment resolved, or open again. */
export function setCommentResolved(
	text: string,
	id: string,
	resolved: boolean,
): string {
	const comment = commentService
		.parseComments(text)
		.find((entry) => entry.id === id);
	if (
		!comment ||
		comment.resolved === resolved ||
		comment.openTagEnd === undefined ||
		comment.closeTagStart === undefined ||
		comment.closeTagEnd === undefined
	) {
		return text;
	}
	const tags = commentService.resolveComment({ ...comment, resolved });
	return (
		text.slice(0, comment.startPosition) +
		tags.openTag +
		text.slice(comment.openTagEnd, comment.closeTagStart) +
		tags.closeTag +
		text.slice(comment.closeTagEnd)
	);
}
