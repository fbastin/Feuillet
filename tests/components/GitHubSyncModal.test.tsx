import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/i18n', () => ({
	t: (key: string, vars?: Record<string, unknown>) => {
		if (!vars) return key;
		return Object.entries(vars).reduce(
			(value, [name, replacement]) =>
				value.replaceAll(`{${name}}`, String(replacement)),
			key,
		);
	},
}));

jest.mock('@/branding', () => ({ APP_NAME: 'Feuillet' }));

jest.mock('@/logging', () => ({
	createNamedLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@src/hooks/useAuth', () => ({
	useAuth: () => ({ user: null }),
}));

jest.mock('@src/hooks/useSettings', () => ({
	useSettings: () => ({ getSetting: jest.fn() }),
}));

const mockSecrets = {
	getSecret: jest.fn(),
	setSecret: jest.fn(async () => undefined),
	hasSecret: jest.fn(() => false),
	removeSecret: jest.fn(async () => undefined),
};

jest.mock('@src/hooks/useSecrets', () => ({
	useSecrets: () => mockSecrets,
}));

const mockFileSystem = {
	getSettings: jest.fn(() => ({
		gitCleanAnnotations: false,
		storeGitOnDisk: false,
	})),
	setGitCleanAnnotations: jest.fn(),
};

jest.mock('@src/services/GitFileSystemService', () => ({
	gitFileSystemService: { get: () => mockFileSystem },
}));

const mockGitService = {
	isInitialized: jest.fn(async () => true),
	getChanges: jest.fn(async () => [] as Array<{ path: string }>),
	getHeadOid: jest.fn(async () => 'local-head' as string | null),
};

jest.mock('@src/services/GitService', () => ({ gitService: mockGitService }));

const mockGetAllFiles = jest.fn(async () => [] as unknown[]);

jest.mock('@src/services/FileStoreService', () => ({
	fileStoreService: { getAllFiles: mockGetAllFiles },
}));

const mockGitSyncService = {
	getConfig: jest.fn(),
	addListener: jest.fn(() => () => undefined),
	connect: jest.fn(async () => undefined),
	disconnect: jest.fn(async () => undefined),
	getSyncStatus: jest.fn(),
};

jest.mock('@src/services/GitSyncService', () => ({
	gitSyncService: mockGitSyncService,
}));

const mockGitProjectSyncService = {
	commitPendingChanges: jest.fn(async () => 'initial-commit'),
	push: jest.fn(),
	pullWithLocalChanges: jest.fn(),
};

jest.mock('@src/services/GitProjectSyncService', () => ({
	gitProjectSyncService: mockGitProjectSyncService,
}));

jest.mock('@src/components/common/Icons', () => ({
	CloseIcon: () => <span>close</span>,
	ExternalLinkIcon: () => null,
	GitPushIcon: () => null,
	DownloadIcon: () => null,
	KeyIcon: () => null,
	UnlinkIcon: () => null,
	CopyUrlIcon: () => null,
}));

import GitHubSyncModal from '@src/components/history/GitHubSyncModal';

const linkedConfig = {
	providerId: 'github',
	providerName: 'GitHub',
	repositoryId: 'octocat/paper',
	repositoryLabel: 'octocat/paper',
	branch: 'main',
	credentialSource: 'backup-global' as const,
};

const makeProvider = () => ({
	id: 'github',
	displayName: 'GitHub',
	historyPluginId: 'texlyre-github-history',
	historyTokenSecretKey: 'github-history-token',
	backupPluginId: 'texlyre-github-backup',
	backupTokenSecretKey: 'github-token',
	testConnection: jest.fn(async () => true),
	listRepositories: jest.fn(async () => []),
	listBranches: jest.fn(async () => []),
	getAccount: jest.fn(async () => ({ login: 'octocat' })),
	createRepository: jest.fn(async () => ({
		id: 'octocat/My-Paper',
		label: 'octocat/My-Paper',
		private: true,
		defaultBranch: 'main',
	})),
	getRepositoryUrl: (repositoryId: string) =>
		`https://github.com/${repositoryId}`,
	getTokenCreationUrl: () => 'https://github.com/settings/tokens/new',
	historyTransport: {} as never,
});

const renderModal = (provider = makeProvider()) => {
	render(
		<GitHubSyncModal
			isOpen
			onClose={jest.fn()}
			projectId='project-1'
			projectName='My Paper'
			projectDescription='A draft'
			provider={provider}
			icon={() => null}
		/>,
	);
	return provider;
};

describe('GitHubSyncModal', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockGitSyncService.getConfig.mockReturnValue(undefined);
		mockSecrets.hasSecret.mockReturnValue(false);
		mockSecrets.getSecret.mockResolvedValue({
			value: 'ghp_token',
			lastModified: 1,
		});
		mockGitService.getHeadOid.mockResolvedValue('local-head');
		mockGitService.getChanges.mockResolvedValue([]);
	});

	it('stores a new token once at account level', async () => {
		const provider = renderModal();

		fireEvent.change(screen.getByLabelText('Personal access token'), {
			target: { value: 'ghp_token' },
		});
		fireEvent.click(screen.getByRole('button', { name: /Connect account/ }));

		await screen.findByText('Signed in to GitHub as octocat');
		expect(provider.testConnection).toHaveBeenCalledWith('ghp_token');
		expect(mockSecrets.setSecret).toHaveBeenCalledWith(
			'texlyre-github-backup',
			'github-token',
			'ghp_token',
			expect.objectContaining({ scope: 'global' }),
		);
	});

	it('creates a private repository, links it, and pushes the project', async () => {
		mockSecrets.hasSecret.mockReturnValue(true);
		mockGitProjectSyncService.push.mockResolvedValue({
			committedOid: null,
			pull: null,
			push: { pushedCommits: 1, repositoryLabel: 'octocat/My-Paper' },
		});
		const provider = renderModal();

		await screen.findByText('Signed in to GitHub as octocat');
		expect(screen.getByLabelText('Repository name')).toHaveValue('My-Paper');
		fireEvent.click(
			screen.getByRole('button', { name: 'Create repository and push' }),
		);

		await screen.findByText(
			'Created octocat/My-Paper and pushed this project to it.',
		);
		expect(provider.createRepository).toHaveBeenCalledWith('ghp_token', {
			name: 'My-Paper',
			description: 'A draft',
			private: true,
		});
		expect(mockGitSyncService.connect).toHaveBeenCalledWith(
			'project-1',
			{
				providerId: 'github',
				repositoryId: 'octocat/My-Paper',
				repositoryLabel: 'octocat/My-Paper',
				branch: 'main',
			},
			{ source: 'backup-global', token: '' },
			expect.anything(),
		);
		expect(mockFileSystem.setGitCleanAnnotations).toHaveBeenCalledWith(true);
		expect(mockGitProjectSyncService.push).toHaveBeenCalledWith(
			'project-1',
			expect.objectContaining({ commitMessage: 'Initial commit from Feuillet' }),
		);
	});

	it('links and pulls a repository imported from the dashboard', async () => {
		mockSecrets.hasSecret.mockReturnValue(true);
		mockGitService.getHeadOid.mockResolvedValue(null);
		mockGitProjectSyncService.pullWithLocalChanges.mockResolvedValue({
			status: 'adopted',
			remoteLabel: 'octocat/thesis · main',
			committedOid: null,
		});
		mockGetAllFiles.mockResolvedValue([
			{
				name: 'one.tex',
				path: '/chapters/one.tex',
				type: 'file',
				content: '\\chapter{One}',
			},
			{
				name: 'thesis.tex',
				path: '/thesis.tex',
				type: 'file',
				content: '\\documentclass{report}',
			},
		]);
		const opened = jest.fn();
		document.addEventListener('navigate-to-compiled-file', opened);
		const onClose = jest.fn();
		render(
			<GitHubSyncModal
				isOpen
				onClose={onClose}
				projectId='project-1'
				projectName='thesis'
				projectDescription=''
				provider={makeProvider()}
				icon={() => null}
				pendingImport={{
					providerId: 'github',
					repository: { id: 'octocat/thesis', label: 'octocat/thesis' },
					branch: 'main',
					cleanAnnotations: true,
				}}
			/>,
		);

		await screen.findByText('Linked octocat/thesis and pulled its files.');
		expect(mockGitSyncService.connect).toHaveBeenCalledTimes(1);
		expect(mockGitSyncService.connect).toHaveBeenCalledWith(
			'project-1',
			expect.objectContaining({ repositoryId: 'octocat/thesis', branch: 'main' }),
			{ source: 'backup-global', token: '' },
			expect.anything(),
		);
		expect(mockFileSystem.setGitCleanAnnotations).toHaveBeenCalledWith(true);
		expect(mockGitProjectSyncService.pullWithLocalChanges).toHaveBeenCalledTimes(
			1,
		);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
			filePath: '/thesis.tex',
		});
		document.removeEventListener('navigate-to-compiled-file', opened);
	});

	it('pushes a linked project with the default commit message', async () => {
		mockGitSyncService.getConfig.mockReturnValue(linkedConfig);
		mockGitService.getChanges.mockResolvedValue([{ path: 'main.tex' }]);
		mockGitSyncService.getSyncStatus.mockResolvedValue({
			remoteHead: 'remote-head',
			remoteChanged: true,
			localAhead: false,
		});
		mockGitProjectSyncService.push.mockResolvedValue({
			committedOid: 'commit',
			pull: { status: 'merged', remoteLabel: 'octocat/paper · main' },
			push: { pushedCommits: 2, repositoryLabel: 'octocat/paper' },
		});
		renderModal();

		await screen.findByText('1 files changed since the last commit.');
		const statusLoads = mockGitSyncService.getSyncStatus.mock.calls.length;
		expect(
			screen.getByText('GitHub has changes that are not in this project yet.'),
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /octocat\/paper/ })).toHaveAttribute(
			'href',
			'https://github.com/octocat/paper',
		);
		// To work on it with Claude Code.
		expect(screen.getByDisplayValue('git clone https://github.com/octocat/paper.git')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }));

		await screen.findByText(
			'The GitHub changes were merged first. Pushed 2 commits to octocat/paper.',
		);
		expect(mockGitProjectSyncService.push).toHaveBeenCalledWith(
			'project-1',
			expect.objectContaining({ commitMessage: 'Update on Feuillet.' }),
		);
		await waitFor(() =>
			expect(mockGitSyncService.getSyncStatus).toHaveBeenCalledTimes(
				statusLoads + 1,
			),
		);
	});
});
