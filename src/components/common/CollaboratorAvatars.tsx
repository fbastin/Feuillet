// src/components/common/CollaboratorAvatars.tsx
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';

import { t } from '@/i18n';
import Popover from './Popover';

interface CollaboratorUser {
	id?: string;
	username: string;
	name?: string;
	email?: string;
	color: string;
	colorLight?: string;
}

export interface CollaboratorState {
	clientId: number;
	user: CollaboratorUser;
	isLocal: boolean;
}

interface CollaboratorAvatarsProps {
	awareness: Awareness;
	maxVisible?: number;
	excludeLocal?: boolean;
	/**
	 * Going to where a collaborator is, as on Overleaf: clicking their
	 * avatar, or their name in the list. Without it, a click shows the list.
	 */
	onSelect?: (collaborator: CollaboratorState) => void;
	/** Whether one can go to them, such as when they have a document open. */
	canSelect?: (collaborator: CollaboratorState) => boolean;
}

const CollaboratorAvatars: React.FC<CollaboratorAvatarsProps> = ({
	awareness,
	maxVisible = 4,
	excludeLocal = false,
	onSelect,
	canSelect,
}) => {
	const [collaborators, setCollaborators] = useState<CollaboratorState[]>([]);
	const [expanded, setExpanded] = useState(false);
	const rowRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const update = () => {
			const states = awareness.getStates();
			const result: CollaboratorState[] = [];

			states.forEach((state, clientId) => {
				if (!state.user) return;
				const isLocal = clientId === awareness.clientID;
				if (excludeLocal && isLocal) return;
				result.push({
					clientId,
					user: state.user as CollaboratorUser,
					isLocal,
				});
			});

			result.sort((a, b) => {
				if (a.isLocal) return -1;
				if (b.isLocal) return 1;
				return (a.user.username || '').localeCompare(b.user.username || '');
			});

			setCollaborators(result);
		};

		awareness.on('change', update);
		update();

		return () => {
			awareness.off('change', update);
		};
	}, [awareness, excludeLocal]);

	if (collaborators.length === 0) return null;

	const visible = collaborators.slice(0, maxVisible);
	const overflow = collaborators.length - maxVisible;

	const getInitial = (user: CollaboratorUser) =>
		(user.name || user.username || '?').charAt(0).toUpperCase();
	const nameOf = (collab: CollaboratorState) =>
		collab.user.name || collab.user.username;
	const selectable = (collab: CollaboratorState) =>
		!!onSelect && !collab.isLocal && (canSelect?.(collab) ?? true);
	const titleOf = (collab: CollaboratorState) =>
		collab.isLocal
			? `${nameOf(collab)} ${t('(you)')}`
			: selectable(collab)
				? t('Go to where {name} is', { name: nameOf(collab) })
				: nameOf(collab);
	const colors = (collab: CollaboratorState) =>
		({
			'--collab-color': collab.user.color,
			'--collab-color-light': collab.user.colorLight || collab.user.color,
		}) as React.CSSProperties;
	const select = (collab: CollaboratorState) => {
		setExpanded(false);
		onSelect?.(collab);
	};

	const renderTooltipContent = (collab: CollaboratorState) => (
		<div className='collab-avatar-tooltip'>
			<div className='collab-avatar-tooltip-name'>
				{nameOf(collab)}
				{collab.isLocal && (
					<span className='collab-avatar-you'>{t('(you)')}</span>
				)}
			</div>
			{collab.user.email && (
				<a
					className='collab-avatar-tooltip-email'
					href={`mailto:${collab.user.email}`}
					onClick={(e) => e.stopPropagation()}
				>
					{collab.user.email}
				</a>
			)}
		</div>
	);

	return (
		<div className='collab-avatars'>
			<div ref={rowRef} className='collab-avatars-row'>
				{visible.map((collab) => (
					<button
						type='button'
						key={collab.clientId}
						className={`collab-avatar ${collab.isLocal ? 'local' : ''}`}
						data-action={selectable(collab) ? 'go-to-collaborator' : undefined}
						data-username={collab.user.username}
						style={colors(collab)}
						title={titleOf(collab)}
						aria-label={titleOf(collab)}
						onClick={(event) => {
							event.stopPropagation();
							if (selectable(collab)) select(collab);
							else setExpanded(!expanded);
						}}
					>
						{getInitial(collab.user)}
					</button>
				))}
				{overflow > 0 && (
					<button
						type='button'
						className='collab-avatar collab-avatar-overflow'
						data-action='show-collaborators'
						title={t('Show everyone')}
						aria-label={t('Show everyone')}
						onClick={(event) => {
							event.stopPropagation();
							setExpanded(!expanded);
						}}
					>
						+{overflow}
					</button>
				)}
			</div>

			<Popover
				anchor={rowRef}
				open={expanded}
				className='collab-avatars-panel'
				clampHeight
				onClose={() => setExpanded(false)}
			>
				{collaborators.map((collab) =>
					selectable(collab) ? (
						<button
							type='button'
							key={collab.clientId}
							className='collab-avatars-panel-item'
							data-action='go-to-collaborator'
							data-username={collab.user.username}
							title={titleOf(collab)}
							onClick={() => select(collab)}
						>
							<div className='collab-avatar' style={colors(collab)}>
								{getInitial(collab.user)}
							</div>
							{renderTooltipContent(collab)}
						</button>
					) : (
						<div key={collab.clientId} className='collab-avatars-panel-item'>
							<div className='collab-avatar' style={colors(collab)}>
								{getInitial(collab.user)}
							</div>
							{renderTooltipContent(collab)}
						</div>
					),
				)}
			</Popover>
		</div>
	);
};

export default CollaboratorAvatars;
