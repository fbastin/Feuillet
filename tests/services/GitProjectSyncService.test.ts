const mockGitService = {
	isInitialized: jest.fn(async () => true),
	initialize: jest.fn(async () => undefined),
	getChanges: jest.fn(async () => [] as Array<{ path: string; type: string }>),
	commit: jest.fn(async () => 'local-commit'),
	getHeadOid: jest.fn(async () => 'local-head' as string | null),
	mergeBranch: jest.fn(),
	completeBranchMerge: jest.fn(),
	resetAll: jest.fn(async () => undefined),
};

const mockGitSyncService = {
	fetchForMerge: jest.fn(),
	adoptFetched: jest.fn(async () => undefined),
	discardFetched: jest.fn(async () => undefined),
	markFetchedSynced: jest.fn(),
	getSyncStatus: jest.fn(async () => ({
		remoteHead: 'remote-head',
		remoteChanged: false,
		localAhead: true,
	})),
	push: jest.fn(async () => ({
		providerName: 'GitHub',
		repositoryLabel: 'owner/repo',
		localBranch: 'main',
		remoteBranch: 'main',
		previousLocalOid: 'local-head',
		canonicalOid: 'local-head',
		pushedCommits: 1,
	})),
};

const mockMergeResolutionService = {
	resolveConflicts: jest.fn(),
};

jest.mock('../../src/services/GitService', () => ({
	gitService: mockGitService,
}));
jest.mock('../../src/services/GitSyncService', () => ({
	gitSyncService: mockGitSyncService,
}));
jest.mock('../../src/services/MergeResolutionService', () => ({
	mergeResolutionService: mockMergeResolutionService,
}));

import { gitProjectSyncService } from '../../src/services/GitProjectSyncService';

const secrets = { getSecret: jest.fn() } as never;
const user = null;

const fetched = {
	providerName: 'GitHub',
	repositoryLabel: 'owner/repo',
	remoteBranch: 'main',
	remoteOid: 'remote-head',
	localOid: 'remote-head',
	temporaryBranch: 'origin/main',
};

const mergedResult = (overrides: Record<string, boolean> = {}) => ({
	status: 'merged' as const,
	oid: 'merge-commit',
	alreadyMerged: false,
	fastForward: false,
	mergeCommit: true,
	...overrides,
});

describe('GitProjectSyncService', () => {
	let historyChanged: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		mockGitService.isInitialized.mockResolvedValue(true);
		mockGitService.getChanges.mockResolvedValue([]);
		mockGitService.getHeadOid.mockResolvedValue('local-head');
		mockGitSyncService.fetchForMerge.mockResolvedValue(fetched);
		mockGitSyncService.getSyncStatus.mockResolvedValue({
			remoteHead: 'remote-head',
			remoteChanged: false,
			localAhead: true,
		});
		mockGitService.mergeBranch.mockResolvedValue(mergedResult());
		historyChanged = jest.fn();
		document.addEventListener('git-history-changed', historyChanged);
	});

	afterEach(() => {
		document.removeEventListener('git-history-changed', historyChanged);
	});

	it('commits pending edits with the message and pushes', async () => {
		mockGitService.getChanges.mockResolvedValue([
			{ path: 'main.tex', type: 'modified' },
		]);

		const result = await gitProjectSyncService.push('project-1', {
			secrets,
			user,
			commitMessage: 'Update on Feuillet.',
		});

		expect(mockGitService.commit).toHaveBeenCalledWith(
			'project-1',
			'Update on Feuillet.',
			user,
		);
		expect(mockGitSyncService.fetchForMerge).not.toHaveBeenCalled();
		expect(mockGitSyncService.push).toHaveBeenCalledWith('project-1', secrets);
		expect(result.committedOid).toBe('local-commit');
		expect(result.push?.pushedCommits).toBe(1);
		expect(historyChanged).toHaveBeenCalled();
	});

	it('initializes Git history before the first push', async () => {
		mockGitService.isInitialized.mockResolvedValue(false);

		await gitProjectSyncService.push('project-1', {
			secrets,
			user,
			commitMessage: 'Initial commit',
		});

		expect(mockGitService.initialize).toHaveBeenCalledWith('project-1');
		expect(mockGitService.commit).not.toHaveBeenCalled();
	});

	it('merges remote changes before pushing when the remote moved', async () => {
		mockGitSyncService.getSyncStatus.mockResolvedValue({
			remoteHead: 'remote-head',
			remoteChanged: true,
			localAhead: true,
		});

		const result = await gitProjectSyncService.push('project-1', {
			secrets,
			user,
			commitMessage: 'Update',
		});

		expect(mockGitService.mergeBranch).toHaveBeenCalledWith(
			'project-1',
			'origin/main',
			user,
			{ allowUnrelatedHistories: true },
		);
		expect(mockGitService.resetAll).toHaveBeenCalledWith('project-1');
		expect(mockGitSyncService.markFetchedSynced).toHaveBeenCalledWith(
			'project-1',
			fetched,
		);
		expect(mockGitSyncService.discardFetched).toHaveBeenCalledWith(
			'project-1',
			'origin/main',
		);
		expect(result.pull).toEqual({
			status: 'merged',
			remoteLabel: 'owner/repo · main',
		});
		expect(mockGitSyncService.push).toHaveBeenCalled();
	});

	it('does not push when the user cancels the merge of remote changes', async () => {
		mockGitSyncService.getSyncStatus.mockResolvedValue({
			remoteHead: 'remote-head',
			remoteChanged: true,
			localAhead: true,
		});
		mockGitService.mergeBranch.mockResolvedValue({
			status: 'conflicts',
			plan: {
				oursBranch: 'main',
				theirsBranch: 'origin/main',
				oursOid: 'local-head',
				theirsOid: 'remote-head',
				conflicts: [
					{
						path: 'main.tex',
						isBinary: false,
						baseContent: 'base',
						localContent: 'local',
						remoteContent: 'remote',
						baseExists: true,
						localExists: true,
						remoteExists: true,
					},
				],
			},
		});
		mockMergeResolutionService.resolveConflicts.mockResolvedValue(null);

		const result = await gitProjectSyncService.push('project-1', {
			secrets,
			user,
			commitMessage: 'Update',
		});

		expect(result.push).toBeNull();
		expect(result.pull?.status).toBe('cancelled');
		expect(mockGitSyncService.push).not.toHaveBeenCalled();
		expect(mockGitSyncService.markFetchedSynced).not.toHaveBeenCalled();
		expect(mockGitSyncService.discardFetched).toHaveBeenCalled();
	});

	it('completes the merge with the resolved conflict text', async () => {
		const plan = {
			oursBranch: 'main',
			theirsBranch: 'origin/main',
			oursOid: 'local-head',
			theirsOid: 'remote-head',
			conflicts: [
				{
					path: 'main.tex',
					isBinary: false,
					baseContent: 'base',
					localContent: 'local',
					remoteContent: 'remote',
					baseExists: true,
					localExists: true,
					remoteExists: true,
				},
			],
		};
		mockGitService.mergeBranch.mockResolvedValue({ status: 'conflicts', plan });
		mockMergeResolutionService.resolveConflicts.mockResolvedValue(
			new Map([['main.tex', { action: 'keep-remote' }]]),
		);
		mockGitService.completeBranchMerge.mockResolvedValue(mergedResult());

		const result = await gitProjectSyncService.pull('project-1', secrets, user);

		expect(mockGitService.completeBranchMerge).toHaveBeenCalledWith(
			'project-1',
			plan,
			new Map([['main.tex', 'remote']]),
			user,
		);
		expect(result.status).toBe('merged');
	});

	it('commits local edits before pulling so they are merged, not blocked', async () => {
		mockGitService.getChanges.mockResolvedValue([
			{ path: 'main.tex', type: 'modified' },
		]);
		mockGitService.mergeBranch.mockResolvedValue(
			mergedResult({ fastForward: true, mergeCommit: false }),
		);

		const result = await gitProjectSyncService.pullWithLocalChanges(
			'project-1',
			{ secrets, user, commitMessage: 'Update' },
		);

		expect(mockGitService.commit.mock.invocationCallOrder[0]).toBeLessThan(
			mockGitSyncService.fetchForMerge.mock.invocationCallOrder[0],
		);
		expect(result).toEqual({
			status: 'fast-forward',
			remoteLabel: 'owner/repo · main',
			committedOid: 'local-commit',
		});
	});

	it('adopts the remote history into an empty project', async () => {
		mockGitService.getHeadOid.mockResolvedValue(null);

		const result = await gitProjectSyncService.pullWithLocalChanges(
			'project-1',
			{ secrets, user, commitMessage: 'Update' },
		);

		expect(mockGitSyncService.adoptFetched).toHaveBeenCalledWith(
			'project-1',
			fetched,
		);
		expect(mockGitService.mergeBranch).not.toHaveBeenCalled();
		expect(result.status).toBe('adopted');
	});

	it('reports an empty remote without touching local history', async () => {
		mockGitSyncService.fetchForMerge.mockResolvedValue(null);

		await expect(
			gitProjectSyncService.pull('project-1', secrets, user),
		).resolves.toEqual({ status: 'empty-remote' });
		expect(mockGitService.resetAll).not.toHaveBeenCalled();
		expect(mockGitSyncService.discardFetched).not.toHaveBeenCalled();
	});

	it('refuses to push a project without any commit', async () => {
		mockGitService.getHeadOid.mockResolvedValue(null);
		mockGitSyncService.getSyncStatus.mockResolvedValue({
			remoteHead: null,
			remoteChanged: false,
			localAhead: false,
		});

		await expect(
			gitProjectSyncService.push('project-1', {
				secrets,
				user,
				commitMessage: 'Update',
			}),
		).rejects.toThrow('The project has no files to push yet.');
		expect(mockGitSyncService.push).not.toHaveBeenCalled();
	});
});
