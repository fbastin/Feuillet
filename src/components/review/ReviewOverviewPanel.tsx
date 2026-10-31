// src/components/review/ReviewOverviewPanel.tsx
// The comments and tracked changes of every file of the project, grouped by
// file, as the overview of Overleaf's review panel: a click opens the file
// at the line.
import type React from 'react';
import { useMemo, useState } from 'react';

import { t } from '@/i18n';
import { useReviewOverview } from '../../hooks/useReviewOverview';
import { gotoEditor } from '../../utils/editorNavigator';
import {
	type ReviewOverviewFile,
	type ReviewOverviewItem,
	filterOverview,
} from '../../utils/reviewOverview';
import { CommentIcon, RefreshIcon, TrackChangesIcon } from '../common/Icons';

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
	const { files, refresh } = useReviewOverview(projectId);
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
							{!collapsed.has(file.path) &&
								file.items.map((item) => (
									<button
										type='button'
										key={`${item.kind}-${item.id}`}
										className='review-overview-item'
										data-kind={item.kind}
										data-change={item.change}
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
										{item.replies > 0 && (
											<span className='review-overview-replies ui-meta'>
												{t('{count} replies', { count: item.replies })}
											</span>
										)}
									</button>
								))}
						</section>
					))
				)}
			</div>
		</div>
	);
};

export default ReviewOverviewPanel;
