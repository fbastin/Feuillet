// src/components/common/PrivacyModal.tsx
import { t } from '@/i18n';
import { Trans } from 'react-i18next';
import type React from 'react';

import { InfoIcon } from './Icons';
import Modal from './Modal';
import { APP_SOURCE_URL } from '@/branding';

interface PrivacyModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const TransLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({
	children,
	...props
}) => <a {...props}>{children}</a>;

const PrivacyModal: React.FC<PrivacyModalProps> = ({ isOpen, onClose }) => {
	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={t('Privacy Information')}
			icon={InfoIcon}
			size='medium'
		>
			<div className='ui-stack' data-gap='md' data-role='privacy'>
				<p>
					<Trans
						i18nKey='Feuillet is hosted at feuillet.slashbin.net. For any question, <issues>open an issue on GitHub</issues>.'
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
				</p>

				<h3>{t("What Feuillet's server keeps")}</h3>
				<ul data-role='privacy-server'>
					<li>
						<strong>{t('Your account:')}</strong>&nbsp;
						{t(
							'your username and a hash of your password, never the password itself; a hash of each of your recovery codes, if you made some; your email address, if you gave one, which serves only to send you a link if you forget your password, through Gmail; your signed-in devices, with the names of their browser and system (such as Firefox on Linux), which you see and sign out in your profile; the list of your projects and the words added to your dictionary, to find them on your other devices.',
						)}
					</li>
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
						<strong>{t('Assistants such as Claude:')}</strong>&nbsp;
						{t(
							'the applications you allowed, when they were last used, and their access tokens, which last an hour and are renewed for 30 days. You disconnect them in your profile, Assistants tab.',
						)}
					</li>
					<li>
						<strong>{t('When compiling:')}</strong>&nbsp;
						{t(
							"the files sent to the TeX Live server stay in a folder of your connection's own, erased when it closes, after 15 minutes without use at the latest.",
						)}
					</li>
					<li>
						<strong>{t('What only passes through:')}</strong>&nbsp;
						{t(
							'signing in with GitHub goes through the server, which does not keep the token: your browser encrypts and keeps it. A file imported from a web address is downloaded by the server for you, without being kept.',
						)}
					</li>
					<li>
						<strong>{t('Server logs:')}</strong>&nbsp;
						{t(
							"the web server notes the IP address and the pages asked for, kept 14 days. The collaboration server notes events such as an account's creation, with its name, but never a project's content or id; it keeps 30 MB of notes at most, erasing the oldest first.",
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

					<li>
						<Trans
							i18nKey='<strong>Google (Gmail):</strong> the emails that confirm a recovery address, or send a link for a forgotten password, go through Gmail, with the address they are sent to (<privacy>Privacy Policy</privacy>)'
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
