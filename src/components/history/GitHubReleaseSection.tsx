// src/components/history/GitHubReleaseSection.tsx
// « Publier une version sur GitHub »: a release at the latest commit on
// GitHub, with the project's PDF, compiled now and attached through
// Feuillet's server. With the repository linked to Zenodo, each release
// receives a DOI. The project must be up to date with GitHub, so that the
// PDF is made of what the release points to.
import type React from 'react';
import { useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import type { GitActionSecrets } from '@/hooks/useGitRemoteAccount';
import { ExternalLinkIcon } from '@/components/common/Icons';
import { accountSyncService } from '@/services/AccountSyncService';
import { authService } from '@/services/AuthService';
import { fileImportService } from '@/services/FileImportService';
import {
	type PublishedRelease,
	ReleaseUploadError,
	publishRelease,
} from '@/services/GitHubReleaseService';
import type { GitRemoteSyncStatus } from '@/services/GitSyncService';
import type { GitRemoteConfig, GitRemoteProvider } from '@/types/gitRemote';
import {
	nextReleaseTag,
	releaseAssetName,
	tagNameProblem,
} from '@/utils/githubRelease';

interface GitHubReleaseSectionProps {
	provider: GitRemoteProvider;
	config: GitRemoteConfig;
	remoteName: string;
	projectId: string;
	projectName: string;
	syncStatus: GitRemoteSyncStatus | null;
	pendingChangeCount: number;
	isBusy: boolean;
	busyAction: string | null;
	run: (
		label: string,
		action: (secrets: GitActionSecrets) => Promise<void>,
	) => Promise<boolean>;
	readToken: (secrets: GitActionSecrets) => Promise<string>;
	createActionSecrets: () => GitActionSecrets;
}

const statusOf = (error: unknown) => (error as { status?: number }).status;

/** What went wrong, in words, for the error line of the window. */
const releaseError = (error: unknown, provider: string): Error => {
	if (error instanceof ReleaseUploadError) {
		switch (error.code) {
			case 'signed_out':
				return new Error(
					t(
						'Attaching the PDF needs a signed-in {app} account: nothing was published.',
						{ app: APP_NAME },
					),
				);
			case 'too_large':
				return new Error(
					t(
						'The PDF is too large to attach (100 MB at most): nothing was published.',
					),
				);
			case 'too_many_uploads':
				return new Error(
					t(
						'Too many PDFs were attached in the last minutes. Try again later: nothing was published.',
					),
				);
			default:
				return new Error(
					error.detail
						? t(
								'{provider} refused the PDF ({detail}): nothing was published.',
								{
									provider,
									detail: error.detail,
								},
							)
						: t('The PDF could not be attached: nothing was published.'),
				);
		}
	}
	const status = statusOf(error);
	if (status === 403 || status === 404) {
		return new Error(
			t(
				'{provider} refused to make the release: the token must be allowed to write to the repository (« repo », or « Contents: write » for a fine-grained token).',
				{ provider },
			),
		);
	}
	if (status === 422) {
		return new Error(
			t('{provider} refused the release: {detail}', {
				provider,
				detail: error instanceof Error ? error.message : String(error),
			}),
		);
	}
	return error instanceof Error ? error : new Error(String(error));
};

const GitHubReleaseSection: React.FC<GitHubReleaseSectionProps> = ({
	provider,
	config,
	remoteName,
	projectId,
	projectName,
	syncStatus,
	pendingChangeCount,
	isBusy,
	busyAction,
	run,
	readToken,
	createActionSecrets,
}) => {
	const releases = provider.releases;
	const [tag, setTag] = useState('');
	const [name, setName] = useState('');
	const [notes, setNotes] = useState('');
	const [attachPdf, setAttachPdf] = useState(true);
	const [prerelease, setPrerelease] = useState(false);
	const [suggested, setSuggested] = useState(false);
	const [published, setPublished] = useState<PublishedRelease | null>(null);

	if (!releases) return null;

	const signedIn = accountSyncService.isLinked();
	const upToDate =
		syncStatus !== null &&
		pendingChangeCount === 0 &&
		!syncStatus.localAhead &&
		!syncStatus.remoteChanged &&
		Boolean(syncStatus.remoteHead);
	const problem = tagNameProblem(tag.trim());

	// The next tag, once the section opens.
	const suggest = async () => {
		if (suggested) return;
		setSuggested(true);
		try {
			const token = await readToken(createActionSecrets());
			const latest = await releases.latestTag(token, config.repositoryId);
			setTag((current) => current || nextReleaseTag(latest));
		} catch {
			setTag((current) => current || 'v1');
		}
	};

	const publish = () =>
		run('release', async (secrets) => {
			const tagName = tag.trim();
			if (tagNameProblem(tagName)) {
				throw new Error(t('Choose a tag name without spaces, as v1 or 2.0.'));
			}
			if (!syncStatus?.remoteHead) {
				throw new Error(
					t(
						'Push and pull first: the release is made of what is on {provider}.',
						{
							provider: remoteName,
						},
					),
				);
			}
			const token = await readToken(secrets);
			try {
				if (await releases.tagExists(token, config.repositoryId, tagName)) {
					throw new Error(
						t('The tag {tag} is already on {provider}: choose another one.', {
							tag: tagName,
							provider: remoteName,
						}),
					);
				}
				let asset:
					| { name: string; type: string; bytes: Uint8Array }
					| undefined;
				if (attachPdf) {
					const project = (await authService.getProjects()).find(
						(entry) => entry.docUrl.split(':').pop() === projectId,
					);
					if (!project) throw new Error(t('Project not found'));
					const pdf = await fileImportService.compileOutput(project);
					asset = {
						name: releaseAssetName(projectName, tagName),
						type: 'application/pdf',
						bytes: new Uint8Array(pdf),
					};
				}
				const result = await publishRelease({
					releases,
					token,
					repositoryId: config.repositoryId,
					input: {
						tagName,
						name: name.trim() || tagName,
						body: notes.trim(),
						targetCommitish: syncStatus.remoteHead,
						prerelease,
					},
					asset,
					upload: async (releaseId, file) => {
						const response = await accountSyncService.uploadReleaseAsset({
							repositoryId: config.repositoryId,
							releaseId,
							name: file.name,
							type: file.type,
							bytes: file.bytes,
							githubToken: token,
						});
						if (!response) throw new ReleaseUploadError('signed_out');
						const body = await response.json().catch(() => ({}));
						if (!response.ok) {
							throw new ReleaseUploadError(
								body.error ?? 'upload_failed',
								body.status,
								body.message,
							);
						}
						return typeof body.url === 'string' ? body.url : undefined;
					},
				});
				setPublished(result);
				setTag(nextReleaseTag(result.tagName));
				setName('');
				setNotes('');
			} catch (error) {
				throw releaseError(error, remoteName);
			}
		});

	return (
		<section
			className='ui-card ui-stack'
			data-gap='sm'
			data-padding='md'
			data-surface='secondary'
			data-role='github-release'
		>
			<details
				className='github-sync-release'
				onToggle={(event) => {
					if ((event.currentTarget as HTMLDetailsElement).open) void suggest();
				}}
			>
				<summary>
					<strong>
						{t('Publish a release on {provider}', { provider: remoteName })}
					</strong>
				</summary>
				<div className='ui-stack' data-gap='sm'>
					<p className='ui-note'>
						{t(
							'A release marks the latest commit on {provider} with a tag, with the PDF compiled now attached. If the repository is linked to Zenodo, each release receives a DOI.',
							{ provider: remoteName },
						)}
					</p>
					{published ? (
						<div
							className='ui-message'
							data-tone='success'
							data-role='release-published'
						>
							{t('Release {tag} published.', { tag: published.tagName })}{' '}
							<a href={published.url} target='_blank' rel='noreferrer'>
								{t('See it on {provider}', { provider: remoteName })}{' '}
								<ExternalLinkIcon />
							</a>
						</div>
					) : null}
					{syncStatus !== null && !upToDate ? (
						<div
							className='ui-message'
							data-tone='warning'
							data-role='release-not-up-to-date'
						>
							{t(
								'Push and pull first: the release is made of what is on {provider}.',
								{ provider: remoteName },
							)}
						</div>
					) : null}
					<label className='ui-field-label' htmlFor='github-release-tag'>
						{t('Tag')}
					</label>
					<input
						id='github-release-tag'
						type='text'
						value={tag}
						disabled={isBusy}
						placeholder='v1'
						onChange={(event) => setTag(event.target.value)}
					/>
					{tag.trim() && problem ? (
						<p className='ui-note' data-tone='error'>
							{t('Choose a tag name without spaces, as v1 or 2.0.')}
						</p>
					) : null}
					<label className='ui-field-label' htmlFor='github-release-name'>
						{t('Title')}
					</label>
					<input
						id='github-release-name'
						type='text'
						value={name}
						disabled={isBusy}
						placeholder={tag.trim() || 'v1'}
						onChange={(event) => setName(event.target.value)}
					/>
					<label className='ui-field-label' htmlFor='github-release-notes'>
						{t('Notes')}
					</label>
					<textarea
						id='github-release-notes'
						rows={3}
						value={notes}
						disabled={isBusy}
						onChange={(event) => setNotes(event.target.value)}
					/>
					<label className='checkbox-control'>
						<input
							type='checkbox'
							id='github-release-pdf'
							checked={attachPdf && signedIn}
							disabled={isBusy || !signedIn}
							onChange={(event) => setAttachPdf(event.target.checked)}
						/>
						<span>{t('Attach the PDF, compiled now with TeX Live')}</span>
					</label>
					{!signedIn ? (
						<p className='ui-note'>
							{t('Attaching the PDF needs a signed-in {app} account.', {
								app: APP_NAME,
							})}
						</p>
					) : null}
					<label className='checkbox-control'>
						<input
							type='checkbox'
							id='github-release-prerelease'
							checked={prerelease}
							disabled={isBusy}
							onChange={(event) => setPrerelease(event.target.checked)}
						/>
						<span>{t('Pre-release')}</span>
					</label>
					<div className='ui-actions'>
						<button
							type='button'
							className='button primary'
							data-action='publish-release'
							disabled={isBusy || !upToDate || problem !== null}
							onClick={() => void publish()}
						>
							{busyAction === 'release'
								? t('Publishing...')
								: t('Publish the release')}
						</button>
					</div>
				</div>
			</details>
		</section>
	);
};

export default GitHubReleaseSection;
