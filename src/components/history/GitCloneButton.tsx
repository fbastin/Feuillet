// src/components/history/GitCloneButton.tsx
// The project's Git address, as Overleaf's Menu > Git: its owner and
// editors clone it, pull and push; its reviewers and readers clone and pull
// it (server/collab/git.js). Git signs in with a Git token from the profile.
// The clone signs its commits with the name the editor shows, as the
// commits Update from Feuillet do, and the profile's Git commit email, as
// pushes to GitHub do. OPEN_GIT_CLONE_EVENT opens it from elsewhere (the
// GitHub window).
import type React from 'react';
import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { t } from '@/i18n';
import {
	AccountServerError,
	type ProjectAccess,
	accountSyncService,
} from '../../services/AccountSyncService';
import CopyField from '../common/CopyField';
import { GitBranchIcon } from '../common/Icons';
import Modal from '../common/Modal';
import { OPEN_PROFILE_EVENT } from '../profile/ProfileSettingsModal';
import ServerAccountLinkForm from '../profile/ServerAccountLinkForm';

export const OPEN_GIT_CLONE_EVENT = 'open-git-clone';

// A folder name for `git clone` from the project's name: letters, digits,
// spaces, dots, dashes and underscores.
const folderOf = (name: string) =>
	name
		.normalize('NFC')
		.replace(/[^\p{L}\p{N} ._-]/gu, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.slice(0, 80);

// A value for the shell, in Unix shells, PowerShell and the Windows command
// prompt alike when it holds only letters, digits, spaces and . _ @ + -;
// otherwise in a Unix shell's single quotes.
const quoted = (value: string) =>
	/^[\p{L}\p{N} ._@+-]+$/u.test(value)
		? `"${value}"`
		: `'${value.replace(/'/g, "'\\''")}'`;

interface GitCloneButtonProps {
	className?: string;
	docUrl: string;
	projectName: string;
}

const GitCloneButton: React.FC<GitCloneButtonProps> = ({
	className = '',
	docUrl,
	projectName,
}) => {
	const projectId = docUrl.startsWith('yjs:') ? docUrl.slice(4) : '';
	const { user } = useAuth();
	const [isOpen, setIsOpen] = useState(false);
	const [access, setAccess] = useState<ProjectAccess | null | undefined>();
	const [error, setError] = useState<string | null>(null);
	const [linked, setLinked] = useState(accountSyncService.isLinked());

	useEffect(() => {
		const open = () => setIsOpen(true);
		document.addEventListener(OPEN_GIT_CLONE_EVENT, open);
		return () => document.removeEventListener(OPEN_GIT_CLONE_EVENT, open);
	}, []);

	useEffect(() => {
		if (!isOpen || !projectId || !linked) return;
		let current = true;
		setAccess(undefined);
		setError(null);
		accountSyncService
			.projectAccess(projectId)
			.then((found) => {
				if (current) setAccess(found);
			})
			.catch((caught) => {
				if (!current) return;
				setAccess(null);
				setError(
					caught instanceof AccountServerError && caught.code === 'unreachable'
						? t('Could not reach the collaboration server.')
						: t('The server could not be reached. Please try again later.'),
				);
			});
		return () => {
			current = false;
		};
	}, [isOpen, projectId, linked]);

	if (!projectId) return null;

	const url = linked ? accountSyncService.gitCloneUrl(projectId) : null;
	const folder = folderOf(projectName);
	const email = user?.gitEmail?.trim() ?? '';
	const author =
		(user?.username ? ` -c user.name=${quoted(user.username)}` : '') +
		(email ? ` -c user.email=${quoted(email)}` : '');
	const command = url
		? `git clone${author} ${url}${folder ? ` "${folder}"` : ''}`
		: '';
	const pushes = access?.role === 'owner' || access?.role === 'editor';

	const openTokens = () => {
		setIsOpen(false);
		document.dispatchEvent(
			new CustomEvent(OPEN_PROFILE_EVENT, { detail: { tab: 'git' } }),
		);
	};

	return (
		<>
			<button
				type='button'
				className={`button git-clone-button ${className}`}
				data-action='open-git'
				title={t('Clone this project with Git')}
				onClick={() => setIsOpen(true)}
			>
				<GitBranchIcon />
				<span className='git-clone-button-label'>{t('Git')}</span>
			</button>
			{isOpen && (
				<Modal
					isOpen={isOpen}
					onClose={() => setIsOpen(false)}
					title={t('Git')}
					icon={GitBranchIcon}
					size='medium'
				>
					<div
						className='ui-stack git-clone'
						data-gap='sm'
						data-role='git-clone'
					>
						{!linked ? (
							<>
								<p>
									{t(
										'Clone this project with Git, work on it on your computer, then push your changes: they appear here at once, for your collaborators too.',
									)}
								</p>
								<ServerAccountLinkForm
									reason={t('Git works with the projects kept on the server.')}
									onLinked={() => setLinked(accountSyncService.isLinked())}
								/>
							</>
						) : access === undefined && !error ? (
							<p className='ui-meta'>{t('Loading...')}</p>
						) : error ? (
							<div className='ui-message' data-tone='error'>
								{error}
							</div>
						) : !access?.role ? (
							<p data-role='git-no-role'>
								{t(
									"Git is for the project's owner and the collaborators invited by name. Ask its owner to invite your account from Share.",
								)}
							</p>
						) : (
							<>
								<p>
									{pushes
										? t(
												'Clone this project with Git, work on it on your computer, then push your changes: they appear here at once, for your collaborators too.',
											)
										: t(
												'Clone this project with Git and pull its changes. Your role lets you read it, not push to it.',
											)}
								</p>
								<CopyField id='git-clone-command' value={command} mono />
								<p className='ui-meta'>
									{t(
										'When Git asks for a password, give a Git token, which you make in your profile; your password does not work there.',
									)}{' '}
									<button
										type='button'
										className='link-button'
										data-action='open-git-tokens'
										onClick={openTokens}
									>
										{t('Make a Git token')}
									</button>
								</p>
								<ul className='ui-meta git-clone-notes'>
									<li>
										{t(
											'The files hold the text as it reads: comments and tracked changes stay in Feuillet, tracked changes as if accepted.',
										)}
									</li>
									{pushes && (
										<>
											<li>
												{t(
													'Pull before you push: a push is refused when the project changed here since your last pull, and Feuillet takes no forced push.',
												)}
											</li>
											<li>
												{email
													? t(
															'Only the master branch is kept. With this command, the clone signs your commits with your name in Feuillet and the Git commit email of your profile, as pushes to GitHub do; collaborators who clone the project see them.',
														)
													: t(
															'Only the master branch is kept. With this command, the clone signs your commits with your name in Feuillet, and with the address your Git gives them unless your profile has a Git commit email; collaborators who clone the project see them.',
														)}
											</li>
										</>
									)}
								</ul>
							</>
						)}
					</div>
				</Modal>
			)}
		</>
	);
};

export default GitCloneButton;
