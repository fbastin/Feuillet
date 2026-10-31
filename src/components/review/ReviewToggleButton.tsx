// src/components/review/ReviewToggleButton.tsx
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { useReview } from '../../hooks/useReview';
import { accountSyncService } from '../../services/AccountSyncService';
import { fileStoreService } from '../../services/FileStoreService';
import PositionedDropdown from '../common/PositionedDropdown';
import {
	ChevronDownIcon,
	ReviewPanelIcon,
	TrackChangesIcon,
} from '../common/Icons';

interface ReviewButtonProps {
	className?: string;
}

export const TrackChangesButton: React.FC<ReviewButtonProps> = ({
	className = '',
}) => {
	const {
		trackChanges,
		trackChangesLocal,
		trackChangesShared,
		canShareTracking,
		toggleTrackChanges,
		toggleTrackChangesShared,
		trackedUsers,
		setUserTracked,
		reviewOnly,
	} = useReview();
	const { user } = useAuth();
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);
	// The project's other editors, to choose whose changes are tracked.
	const [collaborators, setCollaborators] = useState<string[]>([]);
	const groupRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isDropdownOpen) return;
		const projectId = fileStoreService.getCurrentProjectId();
		if (!projectId) return;
		let current = true;
		void accountSyncService.projectPeople(projectId).then((people) => {
			if (!current || !people) return;
			const editors = [
				...(people.owner ? [people.owner] : []),
				...people.members
					.filter((member) => member.role === 'editor')
					.map((member) => member.username),
			];
			setCollaborators(editors);
		});
		return () => {
			current = false;
		};
	}, [isDropdownOpen]);

	const me = user?.username;
	const same = (a: string, b?: string) =>
		!!b && a.toLowerCase() === b.toLowerCase();
	// Editors of the project, and whoever is tracked though no longer one.
	const others = [...collaborators, ...trackedUsers].filter(
		(name, index, names) =>
			!same(name, me) &&
			names.findIndex((other) => same(other, name)) === index,
	);

	if (reviewOnly) {
		return (
			<div className={`ui-control-cluster ${className}`}>
				<button
					type='button'
					className='button tracking-button active'
					aria-disabled='true'
					title={t('As a reviewer, all your changes are tracked')}
				>
					<TrackChangesIcon />
				</button>
			</div>
		);
	}

	return (
		<div className={`ui-control-cluster ${className}`}>
			<div
				className='ui-button-group ui-split-button'
				data-layout='weighted'
				data-trigger-group='true'
				ref={groupRef}
			>
				<button
					type='button'
					className={`button ui-split-main tracking-button ${trackChanges ? 'active' : ''}`}
					onClick={toggleTrackChanges}
					title={
						trackChangesShared
							? t('Tracking changes for all collaborators')
							: t('{action} tracking changes', {
									action: trackChangesLocal ? t('Stop') : t('Start'),
								})
					}
				>
					<TrackChangesIcon />
				</button>

				<button
					type='button'
					className='button ui-split-toggle dropdown-toggle'
					onClick={() => setIsDropdownOpen(!isDropdownOpen)}
					title={t('Tracking Options')}
				>
					<ChevronDownIcon />
				</button>
			</div>

			<PositionedDropdown
				isOpen={isDropdownOpen}
				triggerElement={groupRef.current}
				className='tracking-dropdown'
				onClose={() => setIsDropdownOpen(false)}
			>
				<div
					className='ui-menu-section'
					data-variant='control'
					data-role='tracking-options'
				>
					<div className='ui-menu-title' data-variant='control'>
						{t('Track Changes:')}
					</div>
					<div className='ui-meta'>{t('In every file of the project')}</div>

					<label className='ui-menu-item checkbox-control'>
						<input
							type='checkbox'
							data-tracked='everyone'
							checked={trackChangesShared}
							onChange={toggleTrackChangesShared}
							disabled={!canShareTracking}
						/>
						{t('Everyone')}
					</label>

					{me && (
						<label className='ui-menu-item checkbox-control'>
							<input
								type='checkbox'
								data-tracked={me}
								checked={trackChangesShared || trackChangesLocal}
								onChange={toggleTrackChanges}
								disabled={trackChangesShared || !canShareTracking}
							/>
							{t('You ({name})', { name: me })}
						</label>
					)}

					{others.map((name) => {
						const tracked = trackedUsers.some((entry) => same(entry, name));
						return (
							<label key={name} className='ui-menu-item checkbox-control'>
								<input
									type='checkbox'
									data-tracked={name}
									checked={trackChangesShared || tracked}
									onChange={() => setUserTracked(name, !tracked)}
									disabled={trackChangesShared || !canShareTracking}
								/>
								{name}
							</label>
						);
					})}
				</div>
			</PositionedDropdown>
		</div>
	);
};

const ReviewToggleButton: React.FC<ReviewButtonProps> = ({
	className = '',
}) => {
	const { toggleReviews, showReviews, reviews } = useReview();

	return (
		<button
			type='button'
			className={`button ui-count-control ${className} ${showReviews ? 'active' : ''}`}
			onClick={toggleReviews}
			title={t('{action} Changes{numReviews}', {
				action: showReviews ? t('Hide') : t('Show'),
				numReviews: reviews.length > 0 ? ` (${reviews.length})` : '',
			})}
		>
			<div className='review-button-container ui-count-inline'>
				<ReviewPanelIcon />
				{reviews.length > 0 && (
					<span className='ui-badge' data-variant='count'>
						{reviews.length}
					</span>
				)}
			</div>
		</button>
	);
};

export default ReviewToggleButton;
