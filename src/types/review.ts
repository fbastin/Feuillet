// src/types/review.ts
import type { CommentResponse } from './comments';

export interface Review {
	id: string;
	user: string;
	timestamp: number;
	originalText: string;
	currentText: string;
	responses: CommentResponse[];
	resolved: boolean;
	startPosition: number;
	endPosition: number;
	openTagStart: number;
	openTagEnd: number;
	closeTagStart: number;
	closeTagEnd: number;
	line: number;
}

export interface ReviewRaw {
	openTag: string;
	closeTag: string;
	reviewId: string;
}

export type ReviewSegmentType = 'equal' | 'insert' | 'delete';

export interface ReviewSegment {
	type: ReviewSegmentType;
	text: string;
	from: number;
	to: number;
}

export interface ReviewSnapshot {
	id: string;
	user: string;
	timestamp: number;
	originalText: string;
	currentText: string;
	responses: CommentResponse[];
	resolved: boolean;
	line: number;
	docTop: number;
}

export interface ReviewContextType {
	reviews: ReviewSnapshot[];
	showReviews: boolean;
	toggleReviews: () => void;
	trackChanges: boolean;
	trackChangesLocal: boolean;
	trackChangesShared: boolean;
	canShareTracking: boolean;
	toggleTrackChanges: () => void;
	toggleTrackChangesShared: () => void;
	/** The accounts whose changes are tracked, everyone's being apart. */
	trackedUsers: string[];
	setUserTracked: (username: string, tracked: boolean) => void;
	acceptReview: (reviewId: string) => void;
	rejectReview: (reviewId: string) => void;
	resolveReview: (reviewId: string) => void;
	acceptAllReviews: () => void;
	rejectAllReviews: () => void;
	resolveAllReviews: () => void;
	addResponse: (reviewId: string, content: string) => void;
	deleteResponse: (reviewId: string, responseId: string) => void;
	/** Changes can be read, not accepted, rejected, resolved or answered. */
	readOnly: boolean;
	/** A reviewer's: every change is tracked; changes can only be answered. */
	reviewOnly: boolean;
}
