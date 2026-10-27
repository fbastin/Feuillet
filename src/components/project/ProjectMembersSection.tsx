// src/components/project/ProjectMembersSection.tsx
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import {
	AccountServerError,
	type MembersChange,
	type ProjectMember,
	accountSyncService,
} from '../../services/AccountSyncService';

interface ProjectMembersSectionProps {
	projectId: string;
	projectName: string;
	projectType: string;
}

const errorMessage = (error: unknown): string => {
	const code = error instanceof AccountServerError ? error.code : '';
	if (code === 'unknown_user') return t('No account has this name.');
	if (code === 'already_owner') return t('You already own this project.');
	if (code === 'unreachable') {
		return t('Could not reach the collaboration server.');
	}
	return t('Could not manage the collaborators.');
};

/**
 * The accounts a project's owner invited, as on Overleaf: they find the
 * project in their list and follow its links when they change. Removing one
 * replaces the link they used.
 */
const ProjectMembersSection: React.FC<ProjectMembersSectionProps> = ({
	projectId,
	projectName,
	projectType,
}) => {
	const [members, setMembers] = useState<ProjectMember[] | null>(null);
	const [username, setUsername] = useState('');
	const [role, setRole] = useState<ProjectMember['role']>('editor');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const change = useCallback(
		async (update: MembersChange = {}) => {
			setError(null);
			setBusy(true);
			try {
				setMembers(await accountSyncService.projectMembers(projectId, update));
				return true;
			} catch (caught) {
				setError(errorMessage(caught));
				return false;
			} finally {
				setBusy(false);
			}
		},
		[projectId],
	);

	useEffect(() => {
		void change();
	}, [change]);

	const invite = async (event: React.FormEvent) => {
		event.preventDefault();
		const name = username.trim();
		if (!name) return;
		const added = await change({
			add: { username: name, role },
			name: projectName,
			type: projectType,
		});
		if (added) setUsername('');
	};

	return (
		<div className='ui-stack' data-gap='xs'>
			<strong>{t('Collaborators')}</strong>
			{error && (
				<div className='ui-message' data-tone='warning'>
					{error}
				</div>
			)}
			{members &&
				(members.length === 0 ? (
					<p className='ui-meta'>{t('No one is invited yet.')}</p>
				) : (
					<ul className='project-share-members' id='share-members'>
						{members.map((member) => (
							<li key={member.username} className='project-share-member'>
								<span>{member.username}</span>
								<span className='ui-meta'>
									{member.role === 'editor' ? t('Can edit') : t('Read-only')}
								</span>
								<button
									type='button'
									className='button secondary'
									disabled={busy}
									onClick={() => void change({ remove: member.username })}
								>
									{t('Remove')}
								</button>
							</li>
						))}
					</ul>
				))}
			<form className='project-share-invite' onSubmit={invite}>
				<input
					id='share-invite-username'
					className='ui-field-control'
					type='text'
					autoComplete='off'
					placeholder={t('Account name')}
					aria-label={t('Account name')}
					value={username}
					onChange={(event) => setUsername(event.target.value)}
				/>
				<select
					id='share-invite-role'
					className='ui-field-control'
					aria-label={t('Role')}
					value={role}
					onChange={(event) =>
						setRole(event.target.value as ProjectMember['role'])
					}
				>
					<option value='editor'>{t('Can edit')}</option>
					<option value='reader'>{t('Read-only')}</option>
				</select>
				<button
					type='submit'
					className='button primary'
					disabled={busy || !username.trim()}
				>
					{t('Invite')}
				</button>
			</form>
			<p className='ui-meta'>
				{t(
					'Invited collaborators find the project in their list and keep their access when its links change. Removing one replaces the link they used.',
				)}
			</p>
		</div>
	);
};

export default ProjectMembersSection;
