// src/components/history/GitHubActionsSection.tsx
// « Compiler sur GitHub à chaque envoi »: a GitHub Actions workflow that
// compiles the project as Feuillet does (utils/githubWorkflow.ts), written
// on GitHub on the linked branch, then pulled into the project. Writing it
// takes a token with « workflow »: GitHub refuses otherwise, and nothing
// changes in the project. A workflow of the same name that Feuillet did not
// write is left alone.
import type React from 'react';
import { useCallback, useState } from 'react';

import { t } from '@/i18n';
import type { GitActionSecrets } from '@/hooks/useGitRemoteAccount';
import { ExternalLinkIcon } from '@/components/common/Icons';
import { collabService } from '@/services/CollabService';
import { fileStoreService } from '@/services/FileStoreService';
import { gitProjectSyncService } from '@/services/GitProjectSyncService';
import { typesetterRegistryService } from '@/services/TypesetterRegistryService';
import type { User } from '@/types/auth';
import type { ProjectMetadata } from '@/types/documents';
import type { GitRemoteConfig, GitRemoteProvider } from '@/types/gitRemote';
import { chooseLatexMainFile } from '@/utils/compilerUtils';
import {
	WORKFLOW_PATH,
	buildWorkflow,
	engineName,
	isFeuilletWorkflow,
} from '@/utils/githubWorkflow';
import { TEXLIVE_TYPESETTER_ID } from '@/utils/texliveTypesetter';

interface GitHubActionsSectionProps {
	provider: GitRemoteProvider;
	config: GitRemoteConfig;
	remoteName: string;
	projectId: string;
	user: User | null;
	isBusy: boolean;
	busyAction: string | null;
	commitMessage: () => string;
	run: (
		label: string,
		action: (secrets: GitActionSecrets) => Promise<void>,
	) => Promise<boolean>;
	readToken: (secrets: GitActionSecrets) => Promise<string>;
	createActionSecrets: () => GitActionSecrets;
	onChanged: (secrets: GitActionSecrets) => Promise<void>;
	/** Asks for a token that may write workflows. */
	onNeedWorkflowToken: () => void;
}

type WorkflowState =
	| { kind: 'loading' }
	| { kind: 'absent' }
	| { kind: 'current'; sha: string }
	| { kind: 'outdated'; sha: string }
	| { kind: 'foreign' };

// The newest year the server's TeX Live has, from the « latest » option.
const latestTexliveYear = (): number | null => {
	const field = typesetterRegistryService
		.get(TEXLIVE_TYPESETTER_ID)
		?.ui?.compile?.fields?.find((entry) => entry.key === 'version');
	const latest = field?.options?.find((option) => option.value === 'latest');
	const year =
		latest && typeof latest.label === 'object'
			? Number(latest.label.params?.year)
			: Number.NaN;
	return Number.isFinite(year) ? year : null;
};

// The project's main document, as its compiles choose it.
const mainFileOf = async (
	metadata: ProjectMetadata | undefined,
): Promise<string | null> => {
	const files = await fileStoreService.getAllFiles(false, false, false);
	const tex = files
		.filter((file) => file.type === 'file' && file.path.endsWith('.tex'))
		.map((file) => file.path);
	const chosen =
		metadata?.mainFile && tex.includes(metadata.mainFile)
			? metadata.mainFile
			: await chooseLatexMainFile(undefined, undefined, tex, (path) =>
					fileStoreService.isRootLatexFile(path),
				);
	return chosen ? chosen.replace(/^\/+/, '') : null;
};

const isScopeRefusal = (error: unknown) => {
	const status = (error as { status?: number }).status;
	const message = error instanceof Error ? error.message : String(error);
	return (
		/workflow/i.test(message) ||
		((status === 403 || status === 404) && /scope|permission/i.test(message))
	);
};

const GitHubActionsSection: React.FC<GitHubActionsSectionProps> = ({
	provider,
	config,
	remoteName,
	projectId,
	user,
	isBusy,
	busyAction,
	commitMessage,
	run,
	readToken,
	createActionSecrets,
	onChanged,
	onNeedWorkflowToken,
}) => {
	const workflows = provider.workflows;
	const [state, setState] = useState<WorkflowState>({ kind: 'loading' });
	const [text, setText] = useState<string | null>(null);
	const [mainFile, setMainFile] = useState<string | null>(null);
	const [engine, setEngine] = useState('pdflatex');
	const [version, setVersion] = useState('latest');
	const [missingScope, setMissingScope] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const load = useCallback(
		async (secrets: GitActionSecrets) => {
			if (!workflows) return;
			setState({ kind: 'loading' });
			// The project's settings as they are now, kept with the project.
			const metadata = collabService
				.getDocContainer(projectId, 'yjs_metadata')
				?.doc.getMap('data')
				.get('projectMetadata') as ProjectMetadata | undefined;
			const options = metadata?.typesetterOptions?.[TEXLIVE_TYPESETTER_ID];
			const chosenEngine = String(options?.engine ?? 'pdflatex');
			const chosenVersion = String(options?.version ?? 'latest');
			setEngine(chosenEngine);
			setVersion(chosenVersion);
			const main = await mainFileOf(metadata);
			setMainFile(main);
			const wanted = main
				? buildWorkflow({
						mainFile: main,
						engine: chosenEngine,
						version: chosenVersion,
						latestYear: latestTexliveYear(),
					})
				: null;
			setText(wanted);
			const token = await readToken(secrets);
			const [scopes, existing] = await Promise.all([
				workflows.tokenScopes(token),
				workflows.readFile(
					token,
					config.repositoryId,
					config.branch,
					WORKFLOW_PATH,
				),
			]);
			setMissingScope(scopes !== null && !scopes.includes('workflow'));
			setState(
				!existing
					? { kind: 'absent' }
					: !isFeuilletWorkflow(existing.text)
						? { kind: 'foreign' }
						: existing.text === wanted
							? { kind: 'current', sha: existing.sha }
							: { kind: 'outdated', sha: existing.sha },
			);
		},
		[workflows, projectId, readToken, config.repositoryId, config.branch],
	);

	if (!workflows) return null;

	const runsUrl = workflows.runsUrl(config.repositoryId);

	const write = () =>
		run('workflow', async (secrets) => {
			if (!text || (state.kind !== 'absent' && state.kind !== 'outdated'))
				return;
			const token = await readToken(secrets);
			try {
				await workflows.writeFile(token, config.repositoryId, {
					branch: config.branch,
					path: WORKFLOW_PATH,
					text,
					message:
						state.kind === 'absent'
							? t('Compile the PDF on GitHub at each push')
							: t('Compile the PDF on GitHub with the project’s settings'),
					...(state.kind === 'outdated' ? { sha: state.sha } : {}),
				});
			} catch (error) {
				if (isScopeRefusal(error)) {
					setMissingScope(true);
					throw new Error(
						t(
							'{provider} refused the file: the token must be allowed to change workflows (« workflow »). Nothing changed in the project.',
							{ provider: remoteName },
						),
					);
				}
				throw error;
			}
			// The commit is on GitHub: into the project, as any change made there.
			await gitProjectSyncService.pullWithLocalChanges(projectId, {
				secrets,
				user,
				commitMessage: commitMessage(),
			});
			setNotice(
				t('The file is on {provider}: each push now compiles the PDF there.', {
					provider: remoteName,
				}),
			);
			await onChanged(secrets);
			await load(secrets);
		});

	const renderState = () => {
		switch (state.kind) {
			case 'loading':
				return (
					<p className='ui-note'>
						{t('Checking {provider}…', { provider: remoteName })}
					</p>
				);
			case 'foreign':
				return (
					<p className='ui-note' data-role='workflow-foreign'>
						{t(
							'{path} already exists on {branch} and was not made by Feuillet: it is left as it is.',
							{ path: WORKFLOW_PATH, branch: config.branch },
						)}
					</p>
				);
			case 'current':
				return (
					<div
						className='ui-message'
						data-tone='success'
						data-role='workflow-current'
					>
						{t('Each push to {branch} compiles the PDF on {provider}.', {
							branch: config.branch,
							provider: remoteName,
						})}{' '}
						<a href={runsUrl} target='_blank' rel='noreferrer'>
							{t('See the runs')} <ExternalLinkIcon />
						</a>
					</div>
				);
			default:
				return null;
		}
	};

	return (
		<section
			className='ui-card ui-stack'
			data-gap='sm'
			data-padding='md'
			data-surface='secondary'
			data-role='github-actions'
		>
			<details
				className='github-sync-release'
				onToggle={(event) => {
					if ((event.currentTarget as HTMLDetailsElement).open) {
						setNotice(null);
						void load(createActionSecrets()).catch(() =>
							setState({ kind: 'absent' }),
						);
					}
				}}
			>
				<summary>
					<strong>
						{t('Compile on {provider} at each push', { provider: remoteName })}
					</strong>
				</summary>
				<div className='ui-stack' data-gap='sm'>
					<p className='ui-note'>
						{t(
							'A GitHub Actions file compiles the project on {provider} at each push and pull request, as Feuillet does: same main document, engine and TeX Live. The PDF is in each run; an error shows as a failed check on the pull request.',
							{ provider: remoteName },
						)}
					</p>
					{mainFile ? (
						<p className='ui-meta' data-role='workflow-settings'>
							{t('{file}, with {engine}, TeX Live {version}', {
								file: mainFile,
								engine: engineName(engine),
								version: version === 'latest' ? t('latest') : version,
							})}
						</p>
					) : state.kind !== 'loading' ? (
						<p className='ui-note' data-tone='warning'>
							{t('The project has no LaTeX main document to compile.')}
						</p>
					) : null}
					{notice ? (
						<div
							className='ui-message'
							data-tone='success'
							data-role='workflow-notice'
						>
							{notice}{' '}
							<a href={runsUrl} target='_blank' rel='noreferrer'>
								{t('See the runs')} <ExternalLinkIcon />
							</a>
						</div>
					) : (
						renderState()
					)}
					{missingScope &&
					(state.kind === 'absent' || state.kind === 'outdated') ? (
						<div
							className='ui-message'
							data-tone='warning'
							data-role='workflow-scope'
						>
							<p>
								{t(
									'The token cannot change workflows: {provider} would refuse the file. Connect a token allowed « workflow » as well as « repo ».',
									{ provider: remoteName },
								)}
							</p>
							<button
								type='button'
								className='button secondary'
								data-action='workflow-token'
								disabled={isBusy}
								onClick={onNeedWorkflowToken}
							>
								{t('Change token')}
							</button>
						</div>
					) : null}
					{state.kind === 'absent' || state.kind === 'outdated' ? (
						<>
							{state.kind === 'outdated' ? (
								<p className='ui-note' data-role='workflow-outdated'>
									{t(
										'The file on {provider} no longer matches the project’s main document, engine or TeX Live.',
										{ provider: remoteName },
									)}
								</p>
							) : null}
							<button
								type='button'
								className='button primary'
								data-action='write-workflow'
								disabled={isBusy || !text}
								onClick={() => void write()}
							>
								{busyAction === 'workflow'
									? t('Sending...')
									: state.kind === 'absent'
										? t('Add the file on {provider}', { provider: remoteName })
										: t('Update the file on {provider}', {
												provider: remoteName,
											})}
							</button>
							<p className='ui-meta'>
								{t(
									'The file, {path}, then comes into the project like any change made on {provider}.',
									{
										path: WORKFLOW_PATH,
										provider: remoteName,
									},
								)}
							</p>
						</>
					) : null}
				</div>
			</details>
		</section>
	);
};

export default GitHubActionsSection;
