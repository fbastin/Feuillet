// src/contexts/ReviewContext.tsx
import type React from 'react';
import {
	type ReactNode,
	createContext,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import { useAuth } from '../hooks/useAuth';
import { useCaughtUp } from '../hooks/useCaughtUp';
import { useCollab } from '../hooks/useCollab';
import { useProperties } from '../hooks/useProperties';
import { fileStoreService } from '../services/FileStoreService';
import { reviewService } from '../services/ReviewService';
import type { DocumentList, ProjectMetadata } from '../types/documents';
import type { ReviewContextType, ReviewSnapshot } from '../types/review';
import {
	announceReviewSidePanel,
	onReviewSidePanel,
} from '../utils/reviewSidePanel';
import {
	isTracked,
	isUserTracked,
	withEveryoneTracked,
	withLegacyTracking,
	withUserTracked,
} from '../utils/trackChangesUtils';

export const ReviewContext = createContext<ReviewContextType | null>(null);

interface ReviewProviderProps {
	children: ReactNode;
	documentKey: string;
	sharedKey?: string;
	readOnly?: boolean;
	// A reviewer's: every change is tracked, and only editors decide.
	reviewOnly?: boolean;
}

const dispatchReviewEvent = (
	name: string,
	detail: Record<string, unknown> = {},
) => {
	document.dispatchEvent(new CustomEvent(name, { detail }));
};

export const ReviewProvider: React.FC<ReviewProviderProps> = ({
	children,
	documentKey,
	sharedKey,
	readOnly = false,
	reviewOnly = false,
}) => {
	const [reviews, setReviews] = useState<ReviewSnapshot[]>([]);
	const [showReviews, setShowReviews] = useState<boolean>(false);
	// Tracked in this file by the per-file tracking of before, until it is
	// the project's.
	const [legacyTrackedHere, setLegacyTrackedHere] = useState(false);
	const [propertiesLoaded, setPropertiesLoaded] = useState(false);
	const { user } = useAuth();
	const {
		data: doc,
		doc: metadataDoc,
		provider: metadataProvider,
	} = useCollab<DocumentList>();
	const {
		isReady: arePropertiesReady,
		getProperty,
		setProperty,
		registerProperty,
	} = useProperties();

	// Whose changes are tracked is the project's, for all its files, as on
	// Overleaf: everyone's, or those of chosen accounts.
	const username = user?.username;
	const trackingSetting = doc?.projectMetadata?.trackChanges;
	const trackChangesShared = !!trackingSetting?.everyone;
	const trackChangesLocal =
		!!username && isUserTracked(trackingSetting, username);
	const trackedUsers = trackingSetting?.users ?? [];
	const canShareTracking = !!metadataDoc && !readOnly && !reviewOnly;
	const legacySharedHere =
		!!sharedKey && !!doc?.projectMetadata?.trackedFiles?.includes(sharedKey);
	const trackChanges =
		reviewOnly ||
		isTracked(trackingSetting, username) ||
		legacySharedHere ||
		legacyTrackedHere;

	const reviewsRef = useRef<ReviewSnapshot[]>([]);
	const userRef = useRef(user);
	const propertiesRegistered = useRef(false);
	reviewsRef.current = reviews;
	userRef.current = user;

	useEffect(() => {
		if (propertiesRegistered.current) return;
		propertiesRegistered.current = true;

		registerProperty({
			id: 'review-panel-visible',
			category: 'UI',
			subcategory: 'Editor',
			defaultValue: false,
		});
	}, [registerProperty]);

	useEffect(() => {
		if (!arePropertiesReady || propertiesLoaded) return;

		const projectId = fileStoreService.getCurrentProjectId();
		if (projectId) {
			setShowReviews(
				getProperty('review-panel-visible', {
					scope: 'project',
					projectId,
				}) === true,
			);
		}

		setPropertiesLoaded(true);
	}, [arePropertiesReady, propertiesLoaded, getProperty]);

	useEffect(() => {
		if (!arePropertiesReady) return;

		const projectId = fileStoreService.getCurrentProjectId();
		if (!projectId) return;

		const tracked =
			(getProperty('review-tracking-local', {
				scope: 'project',
				projectId,
			}) as Record<string, boolean> | undefined) ?? {};

		setLegacyTrackedHere(tracked[documentKey] === true);
	}, [arePropertiesReady, documentKey, getProperty]);

	const updateTracking = useCallback(
		(change: (current: ProjectMetadata) => ProjectMetadata) => {
			if (!metadataDoc || readOnly || reviewOnly) return;
			const map = metadataDoc.getMap('data');
			metadataDoc.transact(() => {
				const stored = map.get('projectMetadata') as
					| ProjectMetadata
					| undefined;
				const current: ProjectMetadata = stored
					? JSON.parse(JSON.stringify(stored))
					: { name: '', description: '' };
				const next = change(current);
				if (JSON.stringify(next) !== JSON.stringify(current)) {
					map.set('projectMetadata', next);
				}
			});
		},
		[metadataDoc, readOnly, reviewOnly],
	);

	// The tracking chosen per file before becomes the project's, once the
	// project has caught up with the server; then this browser forgets it.
	const caughtUp = useCaughtUp(metadataProvider);
	const broughtIn = useRef<string | null>(null);
	useEffect(() => {
		if (!caughtUp || !canShareTracking || !arePropertiesReady || !doc) return;
		const projectId = fileStoreService.getCurrentProjectId();
		if (!projectId || broughtIn.current === projectId) return;
		broughtIn.current = projectId;
		const scope = { scope: 'project' as const, projectId };
		const local = getProperty('review-tracking-local', scope) as
			| Record<string, boolean>
			| undefined;
		const ownChanges = Object.values(local ?? {}).some(Boolean);
		const sharedFiles = doc.projectMetadata?.trackedFiles?.length ?? 0;
		if (!ownChanges && sharedFiles === 0) return;
		updateTracking((current) =>
			withLegacyTracking(current, { username, ownChanges }),
		);
		if (local) setProperty('review-tracking-local', undefined, scope);
		setLegacyTrackedHere(false);
	}, [
		caughtUp,
		canShareTracking,
		arePropertiesReady,
		doc,
		getProperty,
		setProperty,
		updateTracking,
		username,
	]);

	useEffect(() => {
		if (!propertiesLoaded) return;

		const projectId = fileStoreService.getCurrentProjectId();
		if (!projectId) return;

		setProperty('review-panel-visible', showReviews, {
			scope: 'project',
			projectId,
		});
	}, [showReviews, propertiesLoaded, setProperty]);

	useEffect(() => {
		const handleReviewsChanged = (event: Event) => {
			const detail = (event as CustomEvent).detail ?? {};
			if (detail.reviewsChanged === false) return;

			const next: ReviewSnapshot[] = detail.reviews ?? [];
			const current = reviewsRef.current;

			if (
				next.length === current.length &&
				next.every((review, index) => review === current[index])
			) {
				return;
			}

			reviewsRef.current = next;
			setReviews(next);
		};

		document.addEventListener('reviews-changed', handleReviewsChanged);

		return () =>
			document.removeEventListener('reviews-changed', handleReviewsChanged);
	}, []);

	const publishTrackChanges = useCallback(() => {
		document.dispatchEvent(
			new CustomEvent('set-track-changes', {
				detail: { tracking: trackChanges, author: user?.username ?? '' },
			}),
		);
	}, [trackChanges, user?.username]);

	useEffect(() => {
		publishTrackChanges();

		document.addEventListener('request-track-changes', publishTrackChanges);

		return () =>
			document.removeEventListener(
				'request-track-changes',
				publishTrackChanges,
			);
	}, [publishTrackChanges]);

	// One review panel at a time, as on Overleaf, so the editor keeps its room.
	useEffect(() => {
		if (showReviews) announceReviewSidePanel('changes');
	}, [showReviews]);

	useEffect(
		() =>
			onReviewSidePanel((panel) => {
				if (panel !== 'changes') setShowReviews(false);
			}),
		[],
	);

	const toggleReviews = useCallback(
		() => setShowReviews((visible) => !visible),
		[],
	);

	const setUserTracked = useCallback(
		(name: string, tracked: boolean) => {
			updateTracking((current) => withUserTracked(current, name, tracked));
			if (tracked) setShowReviews(true);
		},
		[updateTracking],
	);

	const toggleTrackChanges = useCallback(() => {
		if (reviewOnly || !username) return;
		setUserTracked(username, !trackChangesLocal);
	}, [reviewOnly, username, trackChangesLocal, setUserTracked]);

	const toggleTrackChangesShared = useCallback(() => {
		if (!canShareTracking) return;
		updateTracking((current) =>
			withEveryoneTracked(current, !trackChangesShared),
		);
		if (!trackChangesShared) setShowReviews(true);
	}, [canShareTracking, updateTracking, trackChangesShared]);

	// Editors decide; the server refuses a reviewer's acceptance anyway.
	const decide = useCallback(
		(name: string, detail: Record<string, unknown> = {}) => {
			if (!reviewOnly) dispatchReviewEvent(name, detail);
		},
		[reviewOnly],
	);
	const acceptReview = useCallback(
		(reviewId: string) => decide('review-accept', { reviewId }),
		[decide],
	);
	const rejectReview = useCallback(
		(reviewId: string) => decide('review-reject', { reviewId }),
		[decide],
	);
	const acceptAllReviews = useCallback(
		() => decide('review-accept-all'),
		[decide],
	);
	const rejectAllReviews = useCallback(
		() => decide('review-reject-all'),
		[decide],
	);

	const setReviewResolved = useCallback(
		(review: ReviewSnapshot, resolved: boolean) =>
			dispatchReviewEvent('review-update', {
				reviewId: review.id,
				rawReview: reviewService.updateReview({ ...review, resolved }),
			}),
		[],
	);

	const resolveReview = useCallback(
		(reviewId: string) => {
			const review = reviewsRef.current.find((entry) => entry.id === reviewId);
			if (!review || reviewOnly) return;

			setReviewResolved(review, !review.resolved);
		},
		[setReviewResolved, reviewOnly],
	);

	const resolveAllReviews = useCallback(() => {
		if (reviewOnly) return;
		for (const review of reviewsRef.current) {
			if (!review.resolved) setReviewResolved(review, true);
		}
	}, [setReviewResolved, reviewOnly]);

	const updateResponses = useCallback(
		(review: ReviewSnapshot, responses: ReviewSnapshot['responses']) => {
			dispatchReviewEvent('review-update', {
				reviewId: review.id,
				rawReview: reviewService.updateReview({ ...review, responses }),
			});
		},
		[],
	);

	const addResponse = useCallback(
		(reviewId: string, content: string) => {
			const currentUser = userRef.current;
			if (!currentUser) return;

			const review = reviewsRef.current.find((entry) => entry.id === reviewId);
			if (!review) return;

			updateResponses(
				review,
				reviewService.addResponse(
					[...review.responses],
					content,
					currentUser.username,
				),
			);
		},
		[updateResponses],
	);

	const deleteResponse = useCallback(
		(reviewId: string, responseId: string) => {
			const review = reviewsRef.current.find((entry) => entry.id === reviewId);
			if (!review) return;

			updateResponses(
				review,
				reviewService.deleteResponse(review.responses, responseId),
			);
		},
		[updateResponses],
	);

	return (
		<ReviewContext.Provider
			value={{
				reviews,
				showReviews,
				toggleReviews,
				trackChanges,
				trackChangesLocal,
				trackChangesShared,
				canShareTracking,
				toggleTrackChanges,
				toggleTrackChangesShared,
				trackedUsers,
				setUserTracked,
				acceptReview,
				rejectReview,
				resolveReview,
				acceptAllReviews,
				rejectAllReviews,
				resolveAllReviews,
				addResponse,
				deleteResponse,
				readOnly,
				reviewOnly,
			}}
		>
			{children}
		</ReviewContext.Provider>
	);
};
