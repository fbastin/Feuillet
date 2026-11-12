// src/components/common/PrivacyModal.tsx
// What Feuillet keeps, for how long, and which other services are involved.
// What differs from one server to another (whom to ask, the service that
// sends its emails, how long its logs and backups last, its sign-ins and
// grammar checking) the server says (server/collab/site.js); until it does,
// or for a server that does not, the page says what Feuillet's own does.
import { t } from '@/i18n';
import { Trans } from 'react-i18next';
import type React from 'react';
import { useEffect, useState } from 'react';

import { InfoIcon } from './Icons';
import Modal from './Modal';
import { APP_SOURCE_URL } from '@/branding';
import {
	type SiteInfo,
	accountSyncService,
} from '../../services/AccountSyncService';

const GMAIL = {
	provider: 'Gmail',
	privacy: 'https://policies.google.com/privacy',
};

interface PrivacyModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const TransLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({
	children,
	...props
}) => <a {...props}>{children}</a>;

const PrivacyModal: React.FC<PrivacyModalProps> = ({ isOpen, onClose }) => {
	const [site, setSite] = useState<SiteInfo | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		let current = true;
		void accountSyncService.siteInfo().then((info) => {
			if (current) setSite(info);
		});
		return () => {
			current = false;
		};
	}, [isOpen]);

	const mail = site ? site.mail : GMAIL;
	const mailer = mail?.provider || t('its mail service');
	const google = site?.signIn.google ?? true;
	const orcid = site?.signIn.orcid ?? true;
	const grammar = site?.grammar ?? true;
	const backupDays = site?.backupDays ?? 14;
	const contact = site?.contact ?? null;

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={t('Privacy Information')}
			icon={InfoIcon}
			size='medium'
		>
			<div className='ui-stack' data-gap='md' data-role='privacy'>
				<p data-role='privacy-host'>
					{contact ? (
						<Trans
							i18nKey='Feuillet is hosted at {host}. For any question: <contact>{contact}</contact>.'
							values={{ host: window.location.host, contact }}
							components={{
								contact: (
									<TransLink
										href={contact.includes('@') ? `mailto:${contact}` : contact}
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					) : (
						<Trans
							i18nKey='Feuillet is hosted at {host}. For any question, <issues>open an issue on GitHub</issues>.'
							values={{ host: window.location.host }}
							components={{
								issues: (
									<TransLink
										href={`${APP_SOURCE_URL}/issues`}
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					)}
				</p>

				<h3>{t("What Feuillet's server keeps")}</h3>
				<ul data-role='privacy-server'>
					<li>
						<strong>{t('Your account:')}</strong>&nbsp;
						{mail
							? t(
									'your username and a hash of your password, never the password itself; a hash of each of your recovery codes, if you made some; your email address, if you gave one, which serves only to send you a link if you forget your password, through {mailer}; your signed-in devices, with the names of their browser and system (such as Firefox on Linux), which you see and sign out in your profile; the list of your projects, the words added to your dictionary and your preferences (the settings of the editor, such as its keybindings and its theme, your Git commit email and your color), to find them on your other devices.',
									{ mailer },
								)
							: t(
									'your username and a hash of your password, never the password itself; a hash of each of your recovery codes, if you made some; your signed-in devices, with the names of their browser and system (such as Firefox on Linux), which you see and sign out in your profile; the list of your projects, the words added to your dictionary and your preferences (the settings of the editor, such as its keybindings and its theme, your Git commit email and your color), to find them on your other devices.',
								)}
					</li>
					{google && (
						<li>
							<strong>{t('Signing in with Google:')}</strong>&nbsp;
							{t(
								'if you link a Google account, a hash of its identifier, which recognizes it; never its address, its name or its picture, which Feuillet does not ask Google for. Unlinking it, or deleting your account, erases it.',
							)}
						</li>
					)}
					<li>
						<strong>{t('Two-factor authentication:')}</strong>&nbsp;
						{t(
							'if you turn it on, the key your authenticator app makes its codes from, and which of its codes was used last, so that each works once. Turning it off erases them.',
						)}
					</li>
					{orcid && (
						<li>
							<strong>{t('Signing in with ORCID:')}</strong>&nbsp;
							{t(
								'if you link an ORCID account, a hash of its ORCID iD, which recognizes it; never the iD itself nor your name, which ORCID also sends and Feuillet does not keep. Unlinking it, or deleting your account, erases it.',
							)}
						</li>
					)}
					<li>
						<strong>{t('Your projects:')}</strong>&nbsp;
						{t(
							'the text of the documents, the files, the comments, the tracked changes and the chat, so that your collaborators receive them even when you are not online; and the versions of the project with their authors, the latest 1000 and those you name.',
						)}
					</li>
					<li>
						<strong>{t('Project sharing:')}</strong>&nbsp;
						{t(
							'the members of each project and their role, and pending invitations, for 30 days at most, with the email address you sent one to.',
						)}
					</li>
					<li>
						<strong>{t('Links to create an account:')}</strong>&nbsp;
						{t(
							'where accounts are made by invitation, those an administrator made, for 7 days at most, and those asked for with an email address, for 24 hours at most, with that address; each goes once it made its account.',
						)}
					</li>
					<li>
						<strong>{t('Assistants such as Claude:')}</strong>&nbsp;
						{t(
							'the applications you allowed, when they were last used, and their access tokens, which last an hour and are renewed for 30 days. You disconnect them in your profile, Assistants tab.',
						)}
					</li>
					<li>
						<strong>{t('Git:')}</strong>&nbsp;
						{t(
							'a hash of each of your Git tokens, with what it is for and when it was last used; and for each project cloned with Git, a Git repository of its files and their commits, which keep the name and address Git gave those who pushed them, as all who clone the project see. It is erased with the project.',
						)}
					</li>
					<li>
						<strong>{t('When compiling:')}</strong>&nbsp;
						{t(
							"the files sent to the TeX Live server stay in a folder of your connection's own, erased when it closes, after 15 minutes without use at the latest. A copy of each project's files is kept apart, for that project alone, so that reopening it does not send them all again: it is erased 7 days after the project's last compile, even if the project was deleted in between.",
						)}
					</li>
					<li>
						<strong>{t('What only passes through:')}</strong>&nbsp;
						{t(
							'signing in with GitHub goes through the server, which does not keep the token: your browser encrypts and keeps it. The PDF of a GitHub release goes through it too, with the token, to be handed to GitHub. A file imported from a web address is downloaded by the server for you, without being kept.',
						)}
					</li>
					<li>
						<strong>{t('Links that open a project:')}</strong>&nbsp;
						{t(
							'what a link or a form of another page gives to /docs (LaTeX code, addresses of files) stays 30 minutes in the memory of the server, the time to create the project, and is never written to disk.',
						)}
					</li>
					{mail && (
						<li>
							<strong>{t('Review emails:')}</strong>&nbsp;
							{t(
								'to tell you that someone replied in a comment thread you wrote in, or mentioned you (@name), the server reads the comment in the document and mails your confirmed address; unticking « Review emails » in the profile stops them.',
							)}
						</li>
					)}
					{grammar && (
						<li>
							<strong>{t('Grammar checking:')}</strong>&nbsp;
							{t(
								'when it is on (Settings), the paragraphs in view of the document you edit go to the server, which checks them with LanguageTool, on the same machine and without access to the Internet, and keeps nothing of them, not even in its logs.',
							)}
						</li>
					)}
					<li data-role='privacy-logs'>
						<strong>{t('Server logs:')}</strong>&nbsp;
						{t(
							"the web server notes the IP address and the pages asked for, kept {days} days. The collaboration server notes events such as an account's creation, with its name, but never a project's content or id; it keeps 30 MB of notes at most, erasing the oldest first.",
							{ days: site?.webLogDays ?? 14 },
						)}
					</li>
				</ul>

				<h3>{t('What your browser keeps')}</h3>
				<p>
					{t(
						'A copy of your projects, to work offline, with the last PDF of each, your settings, and your GitHub, GitLab, Gitea or Forgejo tokens, encrypted with your password.',
					)}
				</p>

				<h3>{t('No tracking')}</h3>
				<p>
					{t(
						'Feuillet has no visit statistics, no advertising and no tracking cookies.',
					)}
				</p>

				<h3>{t('Your Control')}</h3>
				<p>
					{t(
						'In the project list, deleting one of your projects for good erases it from the server, with its documents, files and versions, for its collaborators as well; you may also leave a project shared with you. In your profile, you may disconnect an assistant, export your data and delete your account, which erases the projects you own from the server.',
					)}{' '}
					{backupDays > 0
						? t(
								"The server's backups, made each night, keep what was erased for {days} days at most; only the server's administrator can read them.",
								{ days: backupDays },
							)
						: t(
								"The server's backups, made each night, keep what was erased until its administrator deletes them; only they can read them.",
							)}{' '}
					{t(
						"The server's administrator sees, on an administration page, each account's name, when it was made and last used, how many devices and projects it has, the space its projects take and whether its email address is confirmed, but neither the address nor the projects; they may delete an account, with the projects it owns, and the projects no one can find any more: those on no account's list, a guest's among them, and those whose owner's account was deleted.",
					)}
				</p>

				<h3>{t('Third-Party Services')}</h3>
				<p>
					{t(
						'When you use optional features, data may be sent to external APIs:',
					)}
				</p>
				<ul>
					<li>
						<Trans
							i18nKey='<strong>Anthropic (Claude):</strong> when you connect Claude, it reads and changes the projects your role gives you access to, and what it is sent falls under its terms (<privacy>Privacy Policy</privacy>)'
							components={{
								strong: <strong />,
								privacy: (
									<TransLink
										href='https://www.anthropic.com/legal/privacy'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>
					<li>
						<Trans
							i18nKey='<strong>Crossref API:</strong> Paper titles and authors when using the BibTeX DOI lookup feature (<privacy>Privacy Policy</privacy>)'
							components={{
								strong: <strong />,
								privacy: (
									<TransLink
										href='https://www.crossref.org/privacy/'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>

					{mail && (
						<li data-role='privacy-mail'>
							{mail.privacy ? (
								<Trans
									i18nKey='<strong>{provider}:</strong> the emails that confirm your account email, send a link for a forgotten password, or invite someone to a project, go through {provider}, with the address they are sent to (<privacy>Privacy Policy</privacy>)'
									values={{ provider: mailer }}
									components={{
										strong: <strong />,
										privacy: (
											<TransLink
												href={mail.privacy}
												target='_blank'
												rel='noreferrer'
											/>
										),
									}}
								/>
							) : (
								<Trans
									i18nKey='<strong>{provider}:</strong> the emails that confirm your account email, send a link for a forgotten password, or invite someone to a project, go through {provider}, with the address they are sent to'
									values={{ provider: mailer }}
									components={{ strong: <strong /> }}
								/>
							)}
						</li>
					)}

					{google && (
						<li>
							<Trans
								i18nKey='<strong>Google (sign-in):</strong> when you sign in with Google, Google learns that you sign in to Feuillet, and Feuillet learns only which Google account it is (<privacy>Privacy Policy</privacy>)'
								components={{
									strong: <strong />,
									privacy: (
										<TransLink
											href='https://policies.google.com/privacy'
											target='_blank'
											rel='noreferrer'
										/>
									),
								}}
							/>
						</li>
					)}

					{orcid && (
						<li>
							<Trans
								i18nKey='<strong>ORCID (sign-in):</strong> when you sign in with ORCID, ORCID learns that you sign in to Feuillet, and Feuillet learns only which ORCID iD it is (<privacy>Privacy Policy</privacy>)'
								components={{
									strong: <strong />,
									privacy: (
										<TransLink
											href='https://info.orcid.org/privacy-policy/'
											target='_blank'
											rel='noreferrer'
										/>
									),
								}}
							/>
						</li>
					)}

					<li>
						<Trans
							i18nKey='<strong>GitHub API:</strong> When you enable GitHub integration with your own token (<privacy>Privacy Policy</privacy>)'
							components={{
								strong: <strong />,
								privacy: (
									<TransLink
										href='https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>

					<li>
						<Trans
							i18nKey='<strong>GitLab API:</strong> When you enable GitLab integration with your own token (<privacy>Privacy Policy</privacy>)'
							components={{
								strong: <strong />,
								privacy: (
									<TransLink
										href='https://about.gitlab.com/privacy/'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>

					<li>
						<Trans
							i18nKey='<strong>Gitea API:</strong> When you enable Gitea integration with your own token (<privacy>Privacy Policy</privacy>)'
							components={{
								strong: <strong />,
								privacy: (
									<TransLink
										href='https://docs.gitea.io/en-us/privacy/'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>

					<li>
						<Trans
							i18nKey='<strong>Forgejo API:</strong> When you enable Forgejo integration with your own token (<privacy>Privacy Policy</privacy>). By default, the API endpoint is set to Codeberg (<codebergPrivacy>Privacy Policy</codebergPrivacy>)'
							components={{
								strong: <strong />,
								privacy: (
									<TransLink
										href='https://forgejo.org/privacy-policy/'
										target='_blank'
										rel='noreferrer'
									/>
								),
								codebergPrivacy: (
									<TransLink
										href='https://codeberg.org/Codeberg/org/src/branch/main/PrivacyPolicy.md'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>

					<li>
						<Trans
							i18nKey='<strong>Zotero API:</strong> When you enable Zotero integration with your own API key (<privacy>Privacy Policy</privacy>)'
							components={{
								strong: <strong />,
								privacy: (
									<TransLink
										href='https://www.zotero.org/support/privacy'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>

					<li>
						<Trans
							i18nKey='<strong>OpenAlex API:</strong> Search queries and, if provided, your email (mailto) and API key when using the OpenAlex integration (<privacy>Privacy Policy</privacy>)'
							components={{
								strong: <strong />,
								privacy: (
									<TransLink
										href='https://openalex.org/OpenAlex_privacy_policy.pdf'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>
					<li>
						<Trans
							i18nKey='<strong>TeXlyre</strong>, the project Feuillet comes from: its gallery of templates, the import of a repository by its address, and the LaTeX packages of the compilers that run in the browser (<source>source code</source>)'
							components={{
								strong: <strong />,
								source: (
									<TransLink
										href='https://github.com/TeXlyre/texlyre'
										target='_blank'
										rel='noreferrer'
									/>
								),
							}}
						/>
					</li>
				</ul>

				<h3>{t('Open source')}</h3>
				<p>
					<Trans
						i18nKey='Feuillet is free software (AGPL), based on TeXlyre. The code of the site and of its servers is on <github>GitHub</github>.'
						components={{
							github: (
								<TransLink
									href={APP_SOURCE_URL}
									target='_blank'
									rel='noreferrer'
								/>
							),
						}}
					/>
				</p>
			</div>
		</Modal>
	);
};

export default PrivacyModal;
