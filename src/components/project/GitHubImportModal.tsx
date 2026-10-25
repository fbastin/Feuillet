// src/components/project/GitHubImportModal.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { useGitRemoteAccount } from '@/hooks/useGitRemoteAccount';
import { useSettings } from '@/hooks/useSettings';
import Modal from '@/components/common/Modal';
import GitAccountTokenForm from '@/components/history/GitAccountTokenForm';
import GitRepositoryPicker, {
	type GitRepositorySelection,
} from '@/components/history/GitRepositoryPicker';
import { authService } from '@/services/AuthService';
import type { GitRemoteProvider } from '@/types/gitRemote';
import type { Project, ProjectType } from '@/types/projects';
import { setPendingGitImport } from '@/utils/gitPendingImport';

const moduleLog = createNamedLogger('GitHubImportModal');

interface GitHubImportModalProps {
	isOpen: boolean;
	onClose: () => void;
	provider: GitRemoteProvider;
	icon: React.ComponentType;
	onImported: (project: Project) => void;
}

const projectTypeForLanguage = (language?: string): ProjectType =>
	language?.toLowerCase() === 'typst' ? 'typst' : 'latex';

const GitHubImportModal: React.FC<GitHubImportModalProps> = ({
	isOpen,
	onClose,
	provider,
	icon: ProviderIcon,
	onImported,
}) => {
	const { getSetting } = useSettings();
	const gitAccount = useGitRemoteAccount(provider, isOpen);
	const [showTokenForm, setShowTokenForm] = useState(false);
	const [selection, setSelection] = useState<GitRepositorySelection | null>(
		null,
	);
	const [projectName, setProjectName] = useState('');
	const [projectType, setProjectType] = useState<ProjectType>('latex');
	const [cleanAnnotations, setCleanAnnotations] = useState(true);
	const [isImporting, setIsImporting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isBusy = isImporting || gitAccount.isLoading;

	useEffect(() => {
		provider.configure?.(getSetting);
	}, [getSetting, provider]);

	const handleSelection = (next: GitRepositorySelection | null) => {
		setError(null);
		if (next && next.repository.id !== selection?.repository.id) {
			setProjectName(next.repository.label.split('/').pop() ?? '');
			setProjectType(projectTypeForLanguage(next.repository.language));
		}
		setSelection(next);
	};

	const importRepository = async () => {
		if (!selection || !projectName.trim() || isBusy) return;
		setIsImporting(true);
		setError(null);
		try {
			const project = await authService.createProject({
				name: projectName.trim(),
				description: '',
				type: projectType,
				tags: [],
				isFavorite: false,
			});
			setPendingGitImport(project.id, {
				providerId: provider.id,
				repository: selection.repository,
				branch: selection.branch,
				cleanAnnotations,
			});
			onImported(project);
		} catch (importError) {
			moduleLog.error('Failed to import repository:', importError);
			setError(
				importError instanceof Error
					? importError.message
					: t('Failed to create project'),
			);
		} finally {
			setIsImporting(false);
		}
	};

	const renderAccountLine = () => (
		<div className='github-sync-account ui-meta' data-layout='row'>
			<span>
				{gitAccount.account
					? t('Signed in to {provider} as {login}', {
							provider: provider.displayName,
							login: gitAccount.account.login,
						})
					: t('Checking your {provider} account...', {
							provider: provider.displayName,
						})}
			</span>
			<button
				type='button'
				className='git-history-inline-action'
				disabled={isBusy}
				onClick={() => setShowTokenForm(true)}
			>
				{t('Change token')}
			</button>
		</div>
	);

	const renderImportForm = () => (
		<section
			className='ui-card ui-stack'
			data-gap='md'
			data-padding='md'
			data-surface='secondary'
		>
			{renderAccountLine()}
			<GitRepositoryPicker
				provider={provider}
				readToken={() => gitAccount.readToken(gitAccount.createActionSecrets())}
				disabled={isBusy}
				onChange={handleSelection}
				onError={setError}
			/>
			{selection ? (
				<>
					<label className='ui-field-label' htmlFor='github-import-name'>
						{t('Project Name')}
					</label>
					<input
						id='github-import-name'
						type='text'
						value={projectName}
						disabled={isBusy}
						onChange={(event) => setProjectName(event.target.value)}
					/>
					<label className='ui-field-label' htmlFor='github-import-type'>
						{t('Typesetter Type')}
					</label>
					<select
						id='github-import-type'
						value={projectType}
						disabled={isBusy}
						onChange={(event) => setProjectType(event.target.value)}
					>
						<option value='latex'>{t('LaTeX')}</option>
						<option value='typst'>{t('Typst')}</option>
					</select>
					<label className='checkbox-control'>
						<input
							type='checkbox'
							checked={cleanAnnotations}
							disabled={isBusy}
							onChange={(event) => setCleanAnnotations(event.target.checked)}
						/>
						<span>
							{t('Keep comments and tracked changes out of {provider}', {
								provider: provider.displayName,
							})}
						</span>
					</label>
					<p className='ui-note'>
						{t(
							'The new project stays linked to this repository, so you can push and pull from the GitHub button in the editor.',
						)}
					</p>
					<button
						type='button'
						className='button primary'
						disabled={isBusy || !projectName.trim()}
						onClick={() => void importRepository()}
					>
						{isImporting ? t('Creating project...') : t('Import repository')}
					</button>
				</>
			) : null}
		</section>
	);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={t('Import from {provider}', { provider: provider.displayName })}
			icon={ProviderIcon}
			size='medium'
		>
			<div className='github-sync-modal ui-stack' data-gap='md'>
				{error || gitAccount.error ? (
					<div className='ui-message' data-tone='error'>
						{error ?? gitAccount.error}
					</div>
				) : null}
				{!gitAccount.hasToken || showTokenForm ? (
					<GitAccountTokenForm
						provider={provider}
						isBusy={isBusy}
						onCancel={
							gitAccount.hasToken ? () => setShowTokenForm(false) : undefined
						}
						onSubmit={async (value) => {
							setError(null);
							try {
								await gitAccount.connectToken(value);
								setShowTokenForm(false);
								return true;
							} catch (tokenError) {
								setError(
									tokenError instanceof Error
										? tokenError.message
										: t('Git action failed'),
								);
								return false;
							}
						}}
					/>
				) : (
					renderImportForm()
				)}
			</div>
		</Modal>
	);
};

export default GitHubImportModal;
