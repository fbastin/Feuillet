import {
	setPendingGitImport,
	takePendingGitImport,
} from '@src/utils/gitPendingImport';

describe('pending Git imports', () => {
	beforeEach(() => sessionStorage.clear());

	it('hands a pending import over exactly once', () => {
		const pending = {
			providerId: 'github',
			repository: { id: 'octocat/paper', label: 'octocat/paper' },
			branch: 'main',
			cleanAnnotations: true,
		};
		setPendingGitImport('project-1', pending);

		expect(takePendingGitImport('project-2')).toBeNull();
		expect(takePendingGitImport('project-1')).toEqual(pending);
		expect(takePendingGitImport('project-1')).toBeNull();
	});
});
