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

jest.mock('@src/hooks/useSettings', () => ({
	useSettings: () => ({ getSetting: jest.fn() }),
}));

const mockSecrets = {
	getSecret: jest.fn(async () => ({ value: 'ghp_token', lastModified: 1 })),
	setSecret: jest.fn(async () => undefined),
	hasSecret: jest.fn(() => true),
};

jest.mock('@src/hooks/useSecrets', () => ({
	useSecrets: () => mockSecrets,
}));

const mockCreateProject = jest.fn();

jest.mock('@src/services/AuthService', () => ({
	authService: { createProject: mockCreateProject },
}));

jest.mock('@src/components/common/Icons', () => ({
	CloseIcon: () => <span>close</span>,
	ExternalLinkIcon: () => null,
	KeyIcon: () => null,
}));

import GitHubImportModal from '@src/components/project/GitHubImportModal';
import { takePendingGitImport } from '@src/utils/gitPendingImport';

const provider = {
	id: 'github',
	displayName: 'GitHub',
	historyPluginId: 'texlyre-github-history',
	historyTokenSecretKey: 'github-history-token',
	backupPluginId: 'texlyre-github-backup',
	backupTokenSecretKey: 'github-token',
	testConnection: jest.fn(async () => true),
	getAccount: jest.fn(async () => ({ login: 'octocat' })),
	listRepositories: jest.fn(async () => [
		{
			id: 'octocat/thesis',
			label: 'octocat/thesis',
			private: true,
			defaultBranch: 'main',
			language: 'Typst',
		},
	]),
	listBranches: jest.fn(async () => [{ name: 'main' }, { name: 'draft' }]),
	historyTransport: {} as never,
};

describe('GitHubImportModal', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		sessionStorage.clear();
		mockCreateProject.mockResolvedValue({
			id: 'project-9',
			name: 'thesis',
			docUrl: 'yjs:project-9',
		});
	});

	it('creates a linked project from one of the user repositories', async () => {
		const onImported = jest.fn();
		render(
			<GitHubImportModal
				isOpen
				onClose={jest.fn()}
				provider={provider}
				icon={() => null}
				onImported={onImported}
			/>,
		);

		await screen.findByText('Signed in to GitHub as octocat');
		const list = await screen.findByRole('listbox', { name: 'Repository' });
		fireEvent.change(list, { target: { value: 'octocat/thesis' } });

		await waitFor(() =>
			expect(screen.getByLabelText('Project Name')).toHaveValue('thesis'),
		);
		expect(screen.getByLabelText('Typesetter Type')).toHaveValue('typst');
		expect(provider.listBranches).toHaveBeenCalledWith(
			'ghp_token',
			'octocat/thesis',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Import repository' }));

		await waitFor(() => expect(onImported).toHaveBeenCalled());
		expect(mockCreateProject).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'thesis', type: 'typst' }),
		);
		expect(takePendingGitImport('project-9')).toEqual({
			providerId: 'github',
			repository: expect.objectContaining({ id: 'octocat/thesis' }),
			branch: 'main',
			cleanAnnotations: true,
		});
	});

	it('asks for a token first when none is stored', async () => {
		mockSecrets.hasSecret.mockReturnValueOnce(false).mockReturnValue(false);
		render(
			<GitHubImportModal
				isOpen
				onClose={jest.fn()}
				provider={provider}
				icon={() => null}
				onImported={jest.fn()}
			/>,
		);

		expect(
			await screen.findByLabelText('Personal access token'),
		).toBeInTheDocument();
		expect(provider.listRepositories).not.toHaveBeenCalled();
		mockSecrets.hasSecret.mockReturnValue(true);
	});
});
