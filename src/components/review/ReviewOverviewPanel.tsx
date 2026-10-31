// src/components/review/ReviewOverviewPanel.tsx
// The comments and tracked changes of every file of the project, grouped by
// file, as the overview of Overleaf's review panel: a click opens the file
// at the line.
import type React from 'react';
import { useMemo, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { useCollab } from '../../hooks/useCollab';
import { useReviewOverview } from '../../hooks/useReviewOverview';
import { notificationService } from '../../services/NotificationService';
import { gotoEditor } from '../../utils/editorNavigator';
import {
	type ReviewOverviewFile,
	type ReviewOverviewItem,
	addReply,
	decideAllChanges,
	decideChange,
	deleteReply,
	filterOverview,
	setCommentResolved,
} from '../../utils/reviewOverview';
import {
	CheckIcon,
	CloseIcon,
	CommentIcon,
	RefreshIcon,
	TrackChangesIcon,
} from '../common/Icons';

interface ReviewOverviewPanelProps {
	projectId: string;
	onNavigate: (
		fileId: string,
		line?: number,
		column?: number,
		documentId?: string,
		isLinkedDocument?: boolean,
	) => Promise<void>;
}

const EXCERPT_LENGTH = 120;

const excerpt = (text: string | undefined): string => {
	const flat = (text ?? '').replace(/\s+/g, ' ').trim();
	return flat.length > EXCERPT_LENGTH
		? `${flat.slice(0, EXCERPT_LENGTH)}...`
		: flat;
};

const changeLabel = (item: ReviewOverviewItem): string =>
	item.change === 'inserted'
		? t('Added')
		: item.change === 'deleted'
			? t('Deleted')
			: t('Replaced');

const ReviewOverviewPanel: React.FC<ReviewOverviewPanelProps> = ({
	projectId,
	onNavigate,
}) => {
	const { files, refresh, apply } = useReviewOverview(projectId);
	// Readers and reviewers see the overview; editors decide from it too.
	const { readOnly } = useCollab();
	const { user } = useAuth();
	const [busy, setBusy] = useState<string | null>(null);
	// The comment or change being answered, and the answer so far.
	const [replyingTo, setReplyingTo] = useState<string | null>(null);
	const [draft, setDraft] = useState('');
	const [resolved, setResolved] = useState(false);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const shown = useMemo(
		() => (files ? filterOverview(files, resolved) : []),
		[files, resolved],
	);
	const count = (wantResolved: boolean) =>
		(files ?? []).reduce(
			(total, file) =>
				total +
				file.items.filter((item) => item.resolved === wantResolved).length,
			0,
		);

	const toggle = (path: string) =>
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	const act = async (
		key: string,
		file: ReviewOverviewFile,
		transform: (text: string) => string,
	) => {
		setBusy(key);
		try {
			await apply(file, transform);
			return true;
		} catch (error) {
			notificationService.showError(
				t('The decision could not be applied: {error}', {
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		} finally {
			setBusy(null);
		}
		return false;
	};

	const sendReply = async (
		file: ReviewOverviewFile,
		item: ReviewOverviewItem,
		key: string,
	) => {
		const content = draft.trim();
		if (!content || !user) return;
		const sent = await act(`${key}:reply`, file, (text) =>
			addReply(text, item.kind, item.id, content, user.username),
		);
		if (sent) {
			setReplyingTo(null);
			setDraft('');
		}
	};

	// The thread under a comment or a change: its replies, and for editors
	// a field to answer, as in the review panel.
	const thread = (file: ReviewOverviewFile, item: ReviewOverviewItem) => {
		const key = `${file.path}:${item.kind}:${item.id}`;
		const replying = replyingTo === key;
		if (item.replies.length === 0 && (readOnly || !user)) return null;
		return (
			<div className='review-overview-thread' data-role='thread'>
				{item.replies.map((reply) => (
					<div
						key={reply.id}
						className='review-overview-reply'
						data-role='reply'
					>
						<span className='review-overview-meta ui-meta'>
							<strong>{reply.user}</strong>
							<span>
								{new Date(reply.timestamp).toLocaleString(undefined, {
									dateStyle: 'short',
									timeStyle: 'short',
								})}
							</span>
							{!readOnly && reply.user === user?.username && (
								<button
									type='button'
									className='ui-icon-button review-overview-delete-reply'
									data-variant='subtle'
									data-action='delete-reply'
									disabled={busy !== null}
									title={t('Delete reply')}
									onClick={() =>
										act(`${key}:delete`, file, (text) =>
											deleteReply(text, item.kind, item.id, reply.id),
										)
									}
								>
									<CloseIcon />
								</button>
							)}
						</span>
						<span className='review-overview-text'>{reply.content}</span>
					</div>
				))}
				{!readOnly &&
					user &&
					(replying ? (
						<form
							className='review-overview-reply-form ui-stack'
							data-gap='xs'
							onSubmit={(event) => {
								event.preventDefault();
								void sendReply(file, item, key);
							}}
						>
							<textarea
								className='ui-field-control'
								rows={2}
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Escape') setReplyingTo(null);
									if (
										event.key === 'Enter' &&
										(event.ctrlKey || event.metaKey)
									) {
										event.preventDefault();
										void sendReply(file, item, key);
									}
								}}
								placeholder={t('Write a reply...')}
								aria-label={t('Write a reply...')}
								disabled={busy !== null}
								// biome-ignore lint/a11y/noAutofocus: opened to type the reply.
								autoFocus
							/>
							<div className='ui-actions' data-align='end'>
								<button
									type='button'
									className='button secondary'
									onClick={() => setReplyingTo(null)}
									disabled={busy !== null}
								>
									{t('Cancel')}
								</button>
								<button
									type='submit'
									className='button primary'
									data-action='send-reply'
									disabled={busy !== null || !draft.trim()}
									aria-busy={busy === `${key}:reply`}
								>
									{t('Reply')}
								</button>
							</div>
						</form>
					) : (
						<button
							type='button'
							className='review-overview-reply-button'
							data-action='reply'
							disabled={busy !== null}
							onClick={() => {
								setReplyingTo(key);
								setDraft('');
							}}
						>
							{t('Reply')}
						</button>
					))}
			</div>
		);
	};

	const itemActions = (file: ReviewOverviewFile, item: ReviewOverviewItem) => {
		const key = `${file.path}:${item.id}`;
		const disabled = busy !== null;
		if (item.kind === 'comment') {
			return (
				<button
					type='button'
					className='ui-icon-button'
					data-variant='subtle'
					data-action={item.resolved ? 'reopen' : 'resolve'}
					disabled={disabled}
					aria-busy={busy === key}
					title={item.resolved ? t('Reopen comment') : t('Mark as resolved')}
					onClick={() =>
						act(key, file, (text) =>
							setCommentResolved(text, item.id, !item.resolved),
						)
					}
				>
					{item.resolved ? <RefreshIcon /> : <CheckIcon />}
				</button>
			);
		}
		if (item.resolved) return null;
		return (
			<>
				<button
					type='button'
					className='ui-icon-button'
					data-variant='subtle'
					data-action='accept'
					disabled={disabled}
					aria-busy={busy === key}
					title={t('Accept change')}
					onClick={() =>
						act(key, file, (text) => decideChange(text, item.id, true))
					}
				>
					<CheckIcon />
				</button>
				<button
					type='button'
					className='ui-icon-button'
					data-variant='subtle'
					data-action='reject'
					disabled={disabled}
					title={t('Reject change')}
					onClick={() =>
						act(key, file, (text) => decideChange(text, item.id, false))
					}
				>
					<CloseIcon />
				</button>
			</>
		);
	};

	// Goes to the line at once in an open file, or once the file has opened.
	const open = (file: ReviewOverviewFile, item: ReviewOverviewItem) => {
		gotoEditor(
			file.documentId
				? { kind: 'document', documentId: file.documentId }
				: { kind: 'file', fileId: file.fileId },
			{ line: item.line, column: 1 },
			{ waitForReady: true, fallback: false, timeoutMs: 5000 },
		);
		void onNavigate(
			file.fileId,
			item.line,
			1,
			file.documentId,
			Boolean(file.documentId),
		);
	};

	return (
		<div className='ui-panel review-overview' data-height='full'>
			<div className='ui-panel-header' data-role='explorer' data-position='top'>
				<h3 className='ui-panel-title' data-size='body' data-shrink='true'>
					{t('Review overview')}
				</h3>
				<div className='ui-toolbar-actions' data-gap='sm'>
					<button
						type='button'
						className='ui-icon-button'
						data-variant='subtle'
						onClick={() => void refresh()}
						title={t('Refresh')}
					>
						<RefreshIcon />
					</button>
				</div>
			</div>

			<div className='ui-panel-controls'>
				<div className='ui-tab-list' data-role='panel' data-variant='switcher'>
					<button
						type='button'
						className={`ui-tab ${resolved ? '' : 'active'}`}
						onClick={() => setResolved(false)}
						data-view='active'
					>
						{t('Active')} ({count(false)})
					</button>
					<button
						type='button'
						className={`ui-tab ${resolved ? 'active' : ''}`}
						onClick={() => setResolved(true)}
						data-view='resolved'
					>
						{t('Resolved')} ({count(true)})
					</button>
				</div>
			</div>

			<div
				className='ui-panel-content'
				data-role='review-overview'
				data-overflow='y'
				data-padding='sm'
			>
				{files === null ? (
					<div className='ui-empty-state'>{t('Loading...')}</div>
				) : shown.length === 0 ? (
					<div className='ui-empty-state'>
						{resolved
							? t('No resolved comments or changes in this project.')
							: t('No comments or tracked changes in this project.')}
					</div>
				) : (
					shown.map((file) => (
						<section
							key={file.path}
							className='review-overview-file'
							data-path={file.path}
						>
							<button
								type='button'
								className='review-overview-file-header'
								onClick={() => toggle(file.path)}
								aria-expanded={!collapsed.has(file.path)}
							>
								<span className='review-overview-path'>
									{file.path.replace(/^\//, '')}
								</span>
								<span className='ui-badge' data-variant='count'>
									{file.items.length}
								</span>
							</button>
							{!readOnly &&
								!resolved &&
								file.items.some((item) => item.kind === 'change') && (
									<div
										className='review-overview-file-actions ui-actions'
										data-role='file-changes'
									>
										<button
											type='button'
											className='button secondary'
											data-action='accept-all'
											disabled={busy !== null}
											onClick={() =>
												act(`${file.path}:all`, file, (text) =>
													decideAllChanges(text, true),
												)
											}
										>
											{t('Accept all')}
										</button>
										<button
											type='button'
											className='button secondary'
											data-action='reject-all'
											disabled={busy !== null}
											onClick={() =>
												act(`${file.path}:all`, file, (text) =>
													decideAllChanges(text, false),
												)
											}
										>
											{t('Reject all')}
										</button>
									</div>
								)}
							{!collapsed.has(file.path) &&
								file.items.map((item) => (
									<div
										key={`${item.kind}-${item.id}`}
										className='review-overview-item'
										data-kind={item.kind}
										data-change={item.change}
									>
										<button
											type='button'
											className='review-overview-open'
											onClick={() => open(file, item)}
											title={t('Go to line {line}', { line: item.line })}
										>
											<span className='review-overview-meta ui-meta'>
												{item.kind === 'comment' ? (
													<CommentIcon />
												) : (
													<TrackChangesIcon />
												)}
												<strong>{item.user}</strong>
												<span>
													{new Date(item.timestamp).toLocaleString(undefined, {
														dateStyle: 'short',
														timeStyle: 'short',
													})}
												</span>
												<span className='review-overview-line'>
													{t('Line {line}', { line: item.line })}
												</span>
											</span>
											{item.kind === 'comment' ? (
												<>
													<span className='review-overview-text'>
														{excerpt(item.content)}
													</span>
													{item.quoted && (
														<span className='review-overview-quote ui-meta'>
															« {excerpt(item.quoted)} »
														</span>
													)}
												</>
											) : (
												<span className='review-overview-text'>
													<span className='review-overview-change'>
														{changeLabel(item)}
													</span>{' '}
													{item.removed && <del>{excerpt(item.removed)}</del>}
													{item.removed && item.added && ' → '}
													{item.added && <ins>{excerpt(item.added)}</ins>}
												</span>
											)}
										</button>
										{!readOnly && (
											<div className='review-overview-actions'>
												{itemActions(file, item)}
											</div>
										)}
										{thread(file, item)}
									</div>
								))}
						</section>
					))
				)}
			</div>
		</div>
	);
};

export default ReviewOverviewPanel;
