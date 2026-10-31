// src/components/project/ProjectMembersSection.tsx
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import {
	AccountServerError,
	type MembersChange,
	type ProjectInvite,
	type ProjectMember,
	accountSyncService,
} from '../../services/AccountSyncService';
import { inviteUrl } from '../../utils/urlUtils';
import CopyField from '../common/CopyField';

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
	if (code === 'too_many_invites') {
		return t('Too many invitations are pending; take some back first.');
	}
	return t('Could not manage the collaborators.');
};

const roleLabel = (role: ProjectMember['role']): string => {
	if (role === 'editor') return t('Can edit');
	return role === 'reviewer' ? t('Can review') : t('Read-only');
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
	// Personal invitation links; null from a server that has none.
	const [invites, setInvites] = useState<ProjectInvite[] | null>(null);
	const [inviteRole, setInviteRole] = useState<ProjectMember['role']>('editor');
	const [newInvite, setNewInvite] = useState<string | null>(null);

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

	const changeInvites = useCallback(
		async (update: {
			create?: { role: ProjectMember['role'] };
			revoke?: string;
		}) => {
			setError(null);
			setBusy(true);
			try {
				const result = await accountSyncService.projectInvites(projectId, {
					...update,
					...(update.create ? { name: projectName, type: projectType } : {}),
				});
				if (!result) return;
				setInvites(result.invites);
				if (result.invite) setNewInvite(result.invite.invite);
			} catch (caught) {
				setError(errorMessage(caught));
			} finally {
				setBusy(false);
			}
		},
		[projectId, projectName, projectType],
	);

	useEffect(() => {
		let current = true;
		accountSyncService
			.projectInvites(projectId)
			.then((result) => {
				if (current) setInvites(result?.invites ?? null);
			})
			.catch(() => {
				if (current) setInvites(null);
			});
		return () => {
			current = false;
		};
	}, [projectId]);

	const expiry = (invite: ProjectInvite) =>
		new Date(invite.expiresAt).toLocaleDateString(undefined, {
			dateStyle: 'long',
		});

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
		<section className='ui-stack' data-gap='xs' data-role='share-invite'>
			<strong>{t('Invite collaborators')}</strong>
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
					<option value='editor'>{roleLabel('editor')}</option>
					<option value='reviewer'>{roleLabel('reviewer')}</option>
					<option value='reader'>{roleLabel('reader')}</option>
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
					'Enter the name of their account on this server: they find the project in their list. Someone without an account can be sent a link below.',
				)}{' '}
				{t(
					'Reviewers comment and suggest changes, which editors accept or reject.',
				)}
			</p>
			{invites && (
				<div className='ui-stack' data-gap='xs' data-role='share-invitations'>
					<p className='ui-meta'>
						{t(
							'Or make a personal invitation link: whoever opens it signs in, or creates an account, and joins the project. It works once, for 30 days.',
						)}
					</p>
					<div className='project-share-invite'>
						<select
							id='share-invite-link-role'
							className='ui-field-control'
							aria-label={t('Role')}
							value={inviteRole}
							onChange={(event) =>
								setInviteRole(event.target.value as ProjectMember['role'])
							}
						>
							<option value='editor'>{roleLabel('editor')}</option>
							<option value='reviewer'>{roleLabel('reviewer')}</option>
							<option value='reader'>{roleLabel('reader')}</option>
						</select>
						<button
							type='button'
							className='button secondary'
							data-action='create-invite'
							disabled={busy}
							onClick={() =>
								void changeInvites({ create: { role: inviteRole } })
							}
						>
							{t('Make an invitation link')}
						</button>
					</div>
					{newInvite && invites.some((entry) => entry.invite === newInvite) && (
						<CopyField
							id='share-invite-url'
							label={t('Send this link to the person you invite')}
							value={inviteUrl(newInvite)}
						/>
					)}
					{invites.length > 0 && (
						<ul className='project-share-members' id='share-invites'>
							{invites.map((invite) => (
								<li
									key={invite.invite}
									className='project-share-member'
									data-invite={invite.invite}
								>
									<span>
										{t('Invitation as {role}', {
											role: roleLabel(invite.role),
										})}
									</span>
									<span className='ui-meta'>
										{t('until {date}', { date: expiry(invite) })}
									</span>
									<button
										type='button'
										className='button secondary'
										data-action='copy-invite'
										onClick={() =>
											void navigator.clipboard
												.writeText(inviteUrl(invite.invite))
												.catch(() => {})
										}
									>
										{t('Copy')}
									</button>
									<button
										type='button'
										className='button secondary'
										data-action='revoke-invite'
										disabled={busy}
										onClick={() =>
											void changeInvites({ revoke: invite.invite })
										}
									>
										{t('Take back')}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
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
								<span className='ui-meta'>{roleLabel(member.role)}</span>
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
		</section>
	);
};

export default ProjectMembersSection;
