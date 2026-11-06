// src/components/collab/CollaboratorsPanel.tsx
// Who works on the project, as Overleaf's sharing shows: who is here now
// (and in which file, to go to their cursor), its owner, the accounts
// invited with their role, and those who came by a link given them. The
// collaboration server tells the names (shares.js), only to the project's
// members and to whoever edits or reviews it by a link; people who open a
// link without an account stay unnamed.
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { useCollab } from '../../hooks/useCollab';
import {
	type ProjectPeople,
	accountSyncService,
} from '../../services/AccountSyncService';
import { collaboratorJumpService } from '../../services/CollaboratorJumpService';
import { fileStoreService } from '../../services/FileStoreService';
import type { Document } from '../../types/documents';
import { ShareIcon } from '../common/Icons';

export const OPEN_SHARE_DIALOG_EVENT = 'feuillet-open-share-dialog';

interface CollaboratorsPanelProps {
	documents: Document[];
}

interface Present {
	clientId: number;
	username: string;
	userId?: string;
	color: string;
	isLocal: boolean;
	documentId?: string;
}

const presentOf = (awareness: Awareness): Present[] => {
	const people: Present[] = [];
	awareness.getStates().forEach((state, clientId) => {
		const user = state?.user as
			| { id?: string; username?: string; name?: string; color?: string }
			| undefined;
		if (!user) return;
		const openDocs = state.openDocs;
		people.push({
			clientId,
			username: user.username || user.name || t('Anonymous'),
			userId: user.id,
			color: user.color || '#888',
			isLocal: clientId === awareness.clientID,
			documentId:
				Array.isArray(openDocs) && typeof openDocs[0] === 'string'
					? openDocs[0]
					: undefined,
		});
	});
	// Oneself first, then by name; one line per person, not per tab.
	const seen = new Set<string>();
	return people
		.sort(
			(a, b) =>
				Number(b.isLocal) - Number(a.isLocal) ||
				a.username.localeCompare(b.username),
		)
		.filter((person) => {
			const key = person.userId || person.username;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
};

const roleText = (role: string) =>
	role === 'editor'
		? t('Can edit')
		: role === 'reviewer'
			? t('Can review')
			: t('Read-only');

const accessText = (access: string) =>
	access === 'edit'
		? t('Can edit, by a link')
		: access === 'review'
			? t('Can review, by a link')
			: t('Read-only, by a link');

const Dot: React.FC<{ color: string; name: string }> = ({ color, name }) => (
	<span
		className='collaborators-dot'
		style={{ backgroundColor: color }}
		aria-hidden='true'
	>
		{name.slice(0, 1).toUpperCase()}
	</span>
);

const CollaboratorsPanel: React.FC<CollaboratorsPanelProps> = ({
	documents,
}) => {
	const { provider } = useCollab();
	const { isGuestUser, user } = useAuth();
	const awareness = provider?.awareness as Awareness | undefined;
	const [present, setPresent] = useState<Present[]>([]);
	const [people, setPeople] = useState<ProjectPeople | null | undefined>();
	const [loading, setLoading] = useState(false);
	const signedIn = accountSyncService.isLinked() && !isGuestUser(user);

	useEffect(() => {
		if (!awareness) return;
		const update = () => setPresent(presentOf(awareness));
		update();
		awareness.on('change', update);
		return () => awareness.off('change', update);
	}, [awareness]);

	const load = useCallback(async () => {
		const projectId = fileStoreService.getCurrentProjectId();
		if (!projectId || !signedIn) {
			setPeople(null);
			return;
		}
		setLoading(true);
		try {
			setPeople(await accountSyncService.projectPeople(projectId));
		} finally {
			setLoading(false);
		}
	}, [signedIn]);

	useEffect(() => {
		void load();
	}, [load]);

	const documentName = useMemo(() => {
		const names = new Map(documents.map((doc) => [doc.id, doc.name]));
		return (id?: string) => {
			const name = id ? names.get(id) : undefined;
			return name ? name.replace(/^\//, '') : undefined;
		};
	}, [documents]);

	const goTo = (person: Present) =>
		collaboratorJumpService.request({
			userId: person.userId,
			username: person.username,
			documentId: person.documentId,
		});

	return (
		<div
			className='collaborators-panel ui-stack'
			data-gap='md'
			data-role='collaborators'
		>
			<div className='collaborators-header'>
				<h3>{t('Collaborators')}</h3>
				<button
					type='button'
					className='button secondary'
					data-size='sm'
					data-action='open-share'
					onClick={() =>
						document.dispatchEvent(new CustomEvent(OPEN_SHARE_DIALOG_EVENT))
					}
				>
					<ShareIcon />
					<span>{t('Share')}</span>
				</button>
			</div>

			<section className='ui-stack' data-gap='xs' data-role='online'>
				<h4>{t('Here now ({count})', { count: present.length })}</h4>
				<ul className='collaborators-list'>
					{present.map((person) => {
						const where = documentName(person.documentId);
						return (
							<li
								key={person.clientId}
								data-local={person.isLocal || undefined}
							>
								<Dot color={person.color} name={person.username} />
								<span className='collaborators-who'>
									<span className='collaborators-name'>
										{person.username}
										{person.isLocal ? ` (${t('you')})` : ''}
									</span>
									{where && !person.isLocal ? (
										<button
											type='button'
											className='git-history-inline-action'
											data-action='go-to-collaborator'
											title={t('Go to their cursor')}
											onClick={() => goTo(person)}
										>
											{where}
										</button>
									) : where ? (
										<span className='ui-meta'>{where}</span>
									) : null}
								</span>
							</li>
						);
					})}
				</ul>
			</section>

			<section className='ui-stack' data-gap='xs' data-role='people'>
				<div className='collaborators-header'>
					<h4>{t('People of the project')}</h4>
					{signedIn && (
						<button
							type='button'
							className='git-history-inline-action'
							data-action='refresh-people'
							disabled={loading}
							onClick={() => void load()}
						>
							{t('Refresh')}
						</button>
					)}
				</div>
				{!signedIn ? (
					<p className='ui-note'>
						{t(
							'Sign in to a Feuillet account to see who works on the project.',
						)}
					</p>
				) : people === undefined ? (
					<p className='ui-note'>{t('Loading...')}</p>
				) : people === null ? (
					<p className='ui-note' data-role='people-unavailable'>
						{t(
							"The project's people are shown to its members, and to whoever edits or reviews it by a link.",
						)}
					</p>
				) : (
					<ul className='collaborators-list'>
						{people.owner && (
							<li data-role='owner'>
								<span className='collaborators-who'>
									<span className='collaborators-name'>{people.owner}</span>
									<span className='ui-meta'>{t('Owner')}</span>
								</span>
							</li>
						)}
						{people.members.map((member) => (
							<li key={member.username} data-role='member'>
								<span className='collaborators-who'>
									<span className='collaborators-name'>{member.username}</span>
									<span className='ui-meta'>{roleText(member.role)}</span>
								</span>
							</li>
						))}
						{people.visitors.map((visitor) => (
							<li key={visitor.username} data-role='visitor'>
								<span className='collaborators-who'>
									<span className='collaborators-name'>{visitor.username}</span>
									<span className='ui-meta'>{accessText(visitor.access)}</span>
								</span>
							</li>
						))}
						{!people.owner &&
							people.members.length === 0 &&
							people.visitors.length === 0 && (
								<li className='ui-note'>{t('Nobody yet.')}</li>
							)}
					</ul>
				)}
				<p className='ui-note'>
					{t(
						'Those who open a link without signing in are not named; the chat and the cursors show them while they are here.',
					)}
				</p>
			</section>
		</div>
	);
};

export default CollaboratorsPanel;
