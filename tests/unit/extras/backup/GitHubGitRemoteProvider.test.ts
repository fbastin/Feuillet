import { gitHubAPIService } from '@extras/backup/github/GitHubAPIService';
import { gitHubGitRemoteProvider } from '@extras/backup/github/GitHubGitRemoteProvider';

const response = (status: number, body: unknown): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 409 ? 'Conflict' : 'OK',
		json: jest.fn(async () => body),
	}) as unknown as Response;

const commitBody = (sha: string, tree: string, parents: string[]) => ({
	sha,
	message: 'Message',
	tree: { sha: tree },
	parents: parents.map((parent) => ({ sha: parent })),
	author: { name: 'Author', email: 'author@example.com', date: '2026-09-15T10:00:00Z' },
	committer: { name: 'Author', email: 'author@example.com', date: '2026-09-15T10:00:00Z' },
});

const originalFetch = globalThis.fetch;

describe('GitHubGitRemoteProvider', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	afterEach(() => {
		if (originalFetch) {
			globalThis.fetch = originalFetch;
		} else {
			Reflect.deleteProperty(globalThis, 'fetch');
		}
	});

	it('bootstraps an empty repository and replaces the bootstrap ref with the real root commit', async () => {
		jest
			.spyOn(gitHubAPIService, 'getBranchHeadSha')
			.mockResolvedValue('bootstrap-sha');
		const fetchMock = jest.fn(
			async (
				input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				const url = String(input);
				const method = init?.method ?? 'GET';
				if (
					url.endsWith('/repos/owner/repo/git/matching-refs/heads') &&
					method === 'GET'
				) {
					return response(409, { message: 'Git Repository is empty.' });
				}
				if (url.endsWith('/repos/owner/repo') && method === 'GET') {
					return response(200, { default_branch: 'main' });
				}
				if (url.includes('/contents/.texlyre-init') && method === 'PUT') {
					return response(201, { commit: { sha: 'bootstrap-sha' } });
				}
				if (url.endsWith('/git/blobs') && method === 'POST') {
					return response(201, { sha: 'blob-sha' });
				}
				if (url.endsWith('/git/trees') && method === 'POST') {
					return response(201, { sha: 'tree-sha' });
				}
				if (url.endsWith('/git/commits') && method === 'POST') {
					return response(201, { sha: 'root-sha' });
				}
				if (url.includes('/git/refs/heads/main') && method === 'PATCH') {
					return response(200, {});
				}
				if (url.endsWith('/git/commits/root-sha') && method === 'GET') {
					return response(200, {
						sha: 'root-sha',
						message: 'Initial commit',
						tree: { sha: 'tree-sha' },
						parents: [],
						author: {
							name: 'Author',
							email: 'author@example.com',
							date: '2026-09-15T10:00:00Z',
						},
						committer: {
							name: 'Author',
							email: 'author@example.com',
							date: '2026-09-15T10:00:00Z',
						},
					});
				}
				throw new Error(`Unexpected request: ${method} ${url}`);
			},
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const created = await gitHubGitRemoteProvider.historyTransport.createCommit(
			'token',
			'owner/repo',
			{
				branch: 'main',
				parents: [],
				expectedBranchHead: null,
				updateBranch: true,
				message: 'Initial commit',
				author: {
					name: 'Author',
					email: 'author@example.com',
					date: '2026-09-15T10:00:00Z',
				},
				committer: {
					name: 'Author',
					email: 'author@example.com',
					date: '2026-09-15T10:00:00Z',
				},
				changes: [
					{
						path: 'main.tex',
						type: 'create',
						mode: '100644',
						content: new TextEncoder().encode('content'),
					},
				],
			},
		);

		expect(created).toEqual(expect.objectContaining({ oid: 'root-sha', parents: [] }));
		const patch = fetchMock.mock.calls.find(
			([input, init]) =>
				String(input).includes('/git/refs/heads/main') && init?.method === 'PATCH',
		);
		expect(patch).toBeDefined();
		expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
			sha: 'root-sha',
			force: true,
		});
	});

	it('sends a submodule as the commit it points to, with nothing uploaded', async () => {
		const fetchMock = jest.fn(
			async (
				input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				const url = String(input);
				const method = init?.method ?? 'GET';
				if (url.endsWith('/git/commits/parent-sha') && method === 'GET') {
					return response(200, commitBody('parent-sha', 'parent-tree', []));
				}
				if (url.endsWith('/git/blobs') && method === 'POST') {
					return response(201, { sha: 'blob-sha' });
				}
				if (url.endsWith('/git/trees') && method === 'POST') {
					return response(201, { sha: 'tree-sha' });
				}
				if (url.endsWith('/git/commits') && method === 'POST') {
					return response(201, { sha: 'new-sha' });
				}
				if (url.endsWith('/git/commits/new-sha') && method === 'GET') {
					return response(200, commitBody('new-sha', 'tree-sha', ['parent-sha']));
				}
				throw new Error(`Unexpected request: ${method} ${url}`);
			},
		);
		globalThis.fetch = fetchMock as typeof fetch;
		const signature = {
			name: 'Author',
			email: 'author@example.com',
			date: '2026-09-15T10:00:00Z',
		};

		await gitHubGitRemoteProvider.historyTransport.createCommit(
			'token',
			'owner/repo',
			{
				branch: 'main',
				parents: ['parent-sha'],
				expectedBranchHead: 'parent-sha',
				updateBranch: false,
				message: 'Message',
				author: signature,
				committer: signature,
				changes: [
					{
						path: 'lib/theme',
						type: 'update',
						mode: '160000',
						previousMode: '160000',
						oid: '2'.repeat(40),
					},
					{
						path: 'main.tex',
						type: 'update',
						mode: '100644',
						content: new TextEncoder().encode('text'),
					},
				],
			},
		);

		const blobs = fetchMock.mock.calls.filter(([input]) =>
			String(input).endsWith('/git/blobs'),
		);
		expect(blobs).toHaveLength(1);
		const treeCall = fetchMock.mock.calls.find(([input]) =>
			String(input).endsWith('/git/trees'),
		);
		expect(JSON.parse(String(treeCall?.[1]?.body))).toEqual({
			base_tree: 'parent-tree',
			tree: [
				{ path: 'lib/theme', mode: '160000', type: 'commit', sha: '2'.repeat(40) },
				{ path: 'main.tex', mode: '100644', type: 'blob', sha: 'blob-sha' },
			],
		});
	});
});
