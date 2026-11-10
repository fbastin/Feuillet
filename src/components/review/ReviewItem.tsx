// src/components/review/ReviewItem.tsx
import type React from 'react';
import { forwardRef, memo, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { computeReviewSegments } from '../../extensions/codemirror/review/reviewSegments';
import type { ReviewSnapshot } from '../../types/review';
import { formatDate } from '../../utils/dateUtils';
import { gotoEditor } from '../../utils/editorNavigator';
import {
	CheckIcon,
	CloseIcon,
	EditIcon,
	ResolveIcon,
	TrashIcon,
} from '../common/Icons';
import MessageEditor from '../comments/MessageEditor';

interface ReviewItemProps {
	review: ReviewSnapshot;
	top?: number;
	acceptReview: (reviewId: string) => void;
	rejectReview: (reviewId: string) => void;
	resolveReview: (reviewId: string) => void;
	addResponse: (reviewId: string, content: string) => void;
	deleteResponse: (reviewId: string, responseId: string) => void;
	editResponse?: (
		reviewId: string,
		responseId: string,
		content: string,
	) => void;
	/** Who is writing: their replies can be edited. */
	username?: string;
	readOnly?: boolean;
	/** Whether it may be accepted, rejected or resolved: not by reviewers. */
	canDecide?: boolean;
	/** The change at the cursor in the editor. */
	active?: boolean;
}

const truncateUsername = (username: string, maxLength = 28) =>
	username.length > maxLength
		? `${username.substring(0, maxLength)}...`
		: username;

const ReviewItemBase = forwardRef<HTMLDivElement, ReviewItemProps>(
	(
		{
			review,
			top,
			acceptReview,
			rejectReview,
			resolveReview,
			addResponse,
			deleteResponse,
			editResponse,
			username,
			readOnly = false,
			canDecide = true,
			active = false,
		},
		ref,
	) => {
		const [newResponse, setNewResponse] = useState('');
		const [isAddingResponse, setIsAddingResponse] = useState(false);
		// The reply being rewritten, by its author.
		const [editing, setEditing] = useState<string | null>(null);
		const canEdit = (author: string) =>
			!readOnly &&
			!review.resolved &&
			!!editResponse &&
			!!username &&
			author === username;

		const segments = useMemo(
			() => computeReviewSegments(review.originalText, review.currentText),
			[review.originalText, review.currentText],
		);

		const handleAddResponse = () => {
			if (!newResponse.trim()) return;

			addResponse(review.id, newResponse);
			setNewResponse('');
			setIsAddingResponse(false);
		};

		const handleKeyDown = (event: React.KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				handleAddResponse();
			}
		};

		return (
			<div
				className='review-item ui-card'
				data-role='thread-item'
				data-state={review.resolved ? 'resolved' : undefined}
				data-review-id={review.id}
				data-active={active ? 'true' : undefined}
				ref={ref}
				style={top === undefined ? undefined : { top: `${top}px` }}
			>
				<div className='ui-item-header'>
					<div className='ui-item-author-group'>
						<div className='ui-item-author' title={review.user}>
							{truncateUsername(review.user)}
						</div>
						<div className='ui-item-time'>{formatDate(review.timestamp)}</div>
					</div>
					{!readOnly && canDecide && (
						<div className='ui-actions'>
							<button
								type='button'
								className='ui-icon-button'
								data-variant='ghost'
								data-tone='success'
								data-size='sm'
								onClick={() => resolveReview(review.id)}
								title={
									review.resolved
										? t('Mark as unresolved')
										: t('Mark as resolved')
								}
							>
								<ResolveIcon />
							</button>
						</div>
					)}
				</div>

				<button
					type='button'
					className='review-diff'
					onClick={() => gotoEditor(null, { line: review.line })}
					title={t('Go to line {line}', { line: review.line })}
				>
					{segments.map((segment) => (
						<span
							key={`${segment.type}-${segment.from}-${segment.text}`}
							className={`review-segment review-segment-${segment.type}`}
						>
							{segment.text}
						</span>
					))}
				</button>

				{!readOnly && canDecide && (
					<div className='review-decision' data-role='review-decision'>
						<button
							type='button'
							className='button secondary'
							data-action='reject-change'
							onClick={() => rejectReview(review.id)}
							title={t('Reject change')}
						>
							<CloseIcon />
							{t('Reject')}
						</button>
						<button
							type='button'
							className='button primary'
							data-action='accept-change'
							onClick={() => acceptReview(review.id)}
							title={t('Accept change')}
						>
							<CheckIcon />
							{t('Accept')}
						</button>
					</div>
				)}

				{review.responses.length > 0 && (
					<div className='ui-thread'>
						{review.responses.map((response) => (
							<div key={response.id} className='ui-thread-item'>
								<div className='ui-item-header'>
									<div className='ui-item-author-group'>
										<div className='ui-item-author' title={response.user}>
											{truncateUsername(response.user)}
										</div>
										<div className='ui-item-time'>
											{formatDate(response.timestamp)}
										</div>
									</div>
									{!readOnly && (
										<div className='ui-actions'>
											{canEdit(response.user) && editing !== response.id && (
												<button
													type='button'
													className='ui-icon-button'
													data-variant='ghost'
													data-size='xs'
													data-action='edit-response'
													onClick={() => setEditing(response.id)}
													title={t('Edit response')}
												>
													<EditIcon />
												</button>
											)}
											<button
												type='button'
												className='ui-icon-button'
												data-variant='ghost'
												data-tone='danger'
												data-size='xs'
												onClick={() => deleteResponse(review.id, response.id)}
												title={t('Delete response')}
											>
												<TrashIcon />
											</button>
										</div>
									)}
								</div>
								{editing === response.id ? (
									<MessageEditor
										initial={response.content}
										onSave={(content) => {
											editResponse?.(review.id, response.id, content);
											setEditing(null);
										}}
										onCancel={() => setEditing(null)}
									/>
								) : (
									<div className='ui-item-content'>{response.content}</div>
								)}
							</div>
						))}
					</div>
				)}

				{!review.resolved &&
					!readOnly &&
					(isAddingResponse ? (
						<div className='ui-stack' data-gap='sm'>
							<textarea
								value={newResponse}
								onChange={(event) => setNewResponse(event.target.value)}
								onKeyDown={handleKeyDown}
								placeholder={t('Type your response...')}
								rows={2}
							/>

							<div
								className='ui-actions'
								data-variant='form'
								data-align='end'
								data-cross='stretch'
							>
								<button
									type='button'
									className='button secondary'
									onClick={() => {
										setIsAddingResponse(false);
										setNewResponse('');
									}}
								>
									{t('Cancel')}
								</button>
								<button
									type='button'
									className='button primary'
									onClick={handleAddResponse}
									disabled={!newResponse.trim()}
								>
									{t('Submit')}
								</button>
							</div>
						</div>
					) : (
						<button
							type='button'
							className='button secondary'
							onClick={() => setIsAddingResponse(true)}
						>
							{t('Add response')}
						</button>
					))}
			</div>
		);
	},
);

ReviewItemBase.displayName = 'ReviewItem';

const ReviewItem = memo(
	ReviewItemBase,
	(previous, next) =>
		previous.review === next.review &&
		previous.top === next.top &&
		previous.active === next.active &&
		previous.readOnly === next.readOnly &&
		previous.canDecide === next.canDecide &&
		previous.acceptReview === next.acceptReview &&
		previous.rejectReview === next.rejectReview &&
		previous.resolveReview === next.resolveReview &&
		previous.addResponse === next.addResponse &&
		previous.deleteResponse === next.deleteResponse &&
		previous.editResponse === next.editResponse &&
		previous.username === next.username,
);

export default ReviewItem;
