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

const commitObject = (treeOid: string) => ({
	oid: 'commit',
	message: 'Message',
	parents: [],
	author: { name: 'A', email: 'a@example.com', date: '2026-09-15T10:00:00Z' },
	committer: { name: 'A', email: 'a@example.com', date: '2026-09-15T10:00:00Z' },
	treeOid,
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

	it('sends a submodule as the commit it points to, text in the tree request, and uploads only the other files', async () => {
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
						content: new TextEncoder().encode('\ufeffÉté\r\n'),
					},
					{
						path: 'figure.png',
						type: 'create',
						mode: '100644',
						content: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
					},
					{
						path: 'latin1.tex',
						type: 'create',
						mode: '100644',
						content: Uint8Array.from([0x45, 0x74, 0xe9]),
					},
				],
			},
		);

		const blobs = fetchMock.mock.calls.filter(([input]) =>
			String(input).endsWith('/git/blobs'),
		);
		expect(blobs).toHaveLength(2);
		const treeCall = fetchMock.mock.calls.find(([input]) =>
			String(input).endsWith('/git/trees'),
		);
		expect(JSON.parse(String(treeCall?.[1]?.body))).toEqual({
			base_tree: 'parent-tree',
			tree: [
				{ path: 'lib/theme', mode: '160000', type: 'commit', sha: '2'.repeat(40) },
				{
					path: 'main.tex',
					mode: '100644',
					type: 'blob',
					content: '\ufeffÉté\r\n',
				},
				{ path: 'figure.png', mode: '100644', type: 'blob', sha: 'blob-sha' },
				{ path: 'latin1.tex', mode: '100644', type: 'blob', sha: 'blob-sha' },
			],
		});
	});

	describe('reading a history', () => {
		const listed = (sha: string, parent: string | null) => ({
			sha,
			commit: {
				message: `Commit ${sha}\n`,
				tree: { sha: `tree-${sha}` },
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
				verification: { signature: null, payload: null },
			},
			parents: parent ? [{ sha: parent }] : [],
		});

		it('lists commits a hundred a request, and stops at the first page holding a known one', async () => {
			const history = Array.from({ length: 250 }, (_, index) =>
				listed(`c${250 - index}`, index === 249 ? null : `c${249 - index}`),
			);
			const fetchMock = jest.fn(async (input: Parameters<typeof fetch>[0]) => {
				const url = new URL(String(input));
				const page = Number(url.searchParams.get('page'));
				const size = Number(url.searchParams.get('per_page'));
				return response(200, history.slice((page - 1) * size, page * size));
			});
			globalThis.fetch = fetchMock as typeof fetch;

			const commits =
				await gitHubGitRemoteProvider.historyTransport.listCommits?.(
					'token',
					'owner/repo',
					'c250',
					{ known: async (oid) => oid === 'c120' },
				);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(String(fetchMock.mock.calls[0][0])).toContain(
				'/repos/owner/repo/commits?sha=c250&per_page=100&page=1',
			);
			expect(commits).toHaveLength(200);
			expect(commits?.[0]).toEqual({
				oid: 'c250',
				message: 'Commit c250\n',
				parents: ['c249'],
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
				treeOid: 'tree-c250',
			});
		});

		it('reads a whole tree in one request', async () => {
			const fetchMock = jest.fn(async () =>
				response(200, {
					tree: [
						{ path: 'main.tex', mode: '100644', type: 'blob', sha: 'b1' },
						{ path: 'chapitres', mode: '040000', type: 'tree', sha: 't1' },
						{
							path: 'chapitres/intro.tex',
							mode: '100644',
							type: 'blob',
							sha: 'b2',
						},
						{ path: 'lib/theme', mode: '160000', type: 'commit', sha: 's1' },
					],
					truncated: false,
				}),
			);
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const entries = await gitHubGitRemoteProvider.historyTransport.getTree(
				'token',
				'owner/repo',
				commitObject('root-tree'),
			);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(String(fetchMock.mock.calls[0][0])).toContain(
				'/git/trees/root-tree?recursive=1',
			);
			expect(entries).toEqual([
				{ path: 'main.tex', mode: '100644', type: 'blob', oid: 'b1' },
				{ path: 'chapitres/intro.tex', mode: '100644', type: 'blob', oid: 'b2' },
				{ path: 'lib/theme', mode: '160000', type: 'commit', oid: 's1' },
			]);
		});

		it('reads text files fifty a GraphQL request, leaving binaries and cut texts out', async () => {
			const oids = Array.from({ length: 60 }, (_, index) => `oid${index}`);
			const fetchMock = jest.fn(
				async (
					input: Parameters<typeof fetch>[0],
					init?: Parameters<typeof fetch>[1],
				) => {
					expect(String(input)).toBe('https://api.github.com/graphql');
					const body = JSON.parse(String(init?.body));
					expect(body.variables).toEqual({ owner: 'owner', name: 'repo' });
					const aliases = [
						...String(body.query).matchAll(/(\w+): object\(oid: "(\w+)"\)/g),
					];
					const repository = Object.fromEntries(
						aliases.map(([, alias, oid]) => [
							alias,
							oid === 'oid1'
								? { text: null, isBinary: true, isTruncated: false }
								: oid === 'oid2'
									? { text: 'début', isBinary: false, isTruncated: true }
									: { text: `Été ${oid}\r\n`, isBinary: false, isTruncated: false },
						]),
					);
					return response(200, { data: { repository } });
				},
			);
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const texts = await gitHubGitRemoteProvider.historyTransport.getTextBlobs?.(
				'token',
				'owner/repo',
				oids,
			);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(texts?.size).toBe(58);
			expect(texts?.has('oid1')).toBe(false);
			expect(texts?.has('oid2')).toBe(false);
			expect(new TextDecoder().decode(texts?.get('oid59'))).toBe('Été oid59\r\n');
		});

		it('says so when GraphQL answers with errors only', async () => {
			globalThis.fetch = jest.fn(async () =>
				response(200, { errors: [{ message: 'Something went wrong' }] }),
			) as unknown as typeof fetch;

			await expect(
				gitHubGitRemoteProvider.historyTransport.getTextBlobs?.(
					'token',
					'owner/repo',
					['oid'],
				),
			).rejects.toThrow('Something went wrong');
		});

		it('walks the tree folder by folder when GitHub cuts the whole one short', async () => {
			const fetchMock = jest.fn(async (input: Parameters<typeof fetch>[0]) => {
				const url = String(input);
				if (url.includes('recursive=1')) {
					return response(200, { tree: [], truncated: true });
				}
				if (url.includes('/git/trees/root-tree')) {
					return response(200, {
						tree: [
							{ path: 'main.tex', mode: '100644', type: 'blob', sha: 'b1' },
							{ path: 'chapitres', mode: '040000', type: 'tree', sha: 't1' },
						],
					});
				}
				return response(200, {
					tree: [
						{ path: 'intro.tex', mode: '100644', type: 'blob', sha: 'b2' },
					],
				});
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const entries = await gitHubGitRemoteProvider.historyTransport.getTree(
				'token',
				'owner/repo',
				commitObject('root-tree'),
			);

			expect(entries.map((entry) => entry.path)).toEqual([
				'main.tex',
				'chapitres/intro.tex',
			]);
		});
	});
});
