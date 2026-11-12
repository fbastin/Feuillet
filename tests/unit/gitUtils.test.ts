import type { GitRemoteProvider, GitRepositoryAccess } from '../../src/types/gitRemote';
import {
	explainRepositoryAccess,
	gitRemoteApiRequest,
	gitRemoteRequestError,
	isRateLimited,
	isRejectedToken,
	normalizeGitRepositoryInput,
} from '../../src/utils/gitUtils';

describe('gitUtils', () => {
	it('normalizes repository URLs and SSH paths', () => {
		expect(normalizeGitRepositoryInput('https://git.example/me/project.git')).toBe(
			'me/project',
		);
		expect(normalizeGitRepositoryInput('git@git.example:me/project.git')).toBe(
			'me/project',
		);
	});

	describe('remote API requests', () => {
		const originalFetch = global.fetch;

		afterEach(() => {
			global.fetch = originalFetch;
			jest.restoreAllMocks();
		});

		it('normalizes endpoints and applies provider authentication', async () => {
			const fetchMock = jest.fn(async () =>
				({
					ok: true,
					status: 200,
					statusText: 'OK',
					json: async () => ({ ok: true }),
				}) as Response,
			);
			global.fetch = fetchMock as typeof fetch;

			await expect(
				gitRemoteApiRequest<{ ok: boolean }>({
					providerName: 'Example',
					baseUrl: 'https://git.example/api/v1/',
					token: 'secret',
					endpoint: '/repos/me/project/git/commits/abc',
					requestTimeout: 30,
					authHeaders: (token) => ({ Authorization: `token ${token}` }),
				}),
			).resolves.toEqual({ ok: true });

			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe(
				'https://git.example/api/v1/repos/me/project/git/commits/abc',
			);
			expect(new Headers(init?.headers).get('Authorization')).toBe('token secret');
		});

		it('preserves HTTP status on provider API errors', async () => {
			global.fetch = jest.fn(async () =>
				({
					ok: false,
					status: 404,
					statusText: 'Not Found',
					json: async () => ({ message: 'missing' }),
				}) as Response,
			) as typeof fetch;

			await expect(
				gitRemoteApiRequest({
					providerName: 'Example',
					baseUrl: 'https://git.example/api/v1',
					token: 'secret',
					endpoint: 'missing',
					requestTimeout: 30,
					authHeaders: () => ({}),
				}),
			).rejects.toEqual(
				expect.objectContaining({
					message: "Example API request to 'missing' failed (404): missing",
					status: 404,
				}),
			);
		});

		it('says when the host refuses requests for going too fast, and until when', async () => {
			const reset = Date.UTC(2026, 10, 8, 15, 30) / 1000;
			global.fetch = jest.fn(async () =>
				({
					ok: false,
					status: 403,
					statusText: 'Forbidden',
					headers: new Headers({
						'X-RateLimit-Remaining': '0',
						'X-RateLimit-Reset': String(reset),
					}),
					json: async () => ({
						message: 'API rate limit exceeded for user ID 1.',
					}),
				}) as Response,
			) as typeof fetch;

			const refused = await gitRemoteApiRequest({
				providerName: 'GitHub',
				baseUrl: 'https://api.github.com',
				token: 'secret',
				endpoint: 'repos/a/b/git/trees/t',
				requestTimeout: 30,
				authHeaders: () => ({}),
			}).catch((error) => error);

			const time = new Date(reset * 1000).toLocaleTimeString(undefined, {
				hour: '2-digit',
				minute: '2-digit',
			});
			expect(refused.message).toBe(
				`GitHub limits how many requests an account makes, and this one reached the limit for now. Try again after ${time}.`,
			);
			expect(refused.status).toBe(403);
			expect(isRateLimited(refused)).toBe(true);
			expect(isRateLimited(new Error('other'))).toBe(false);
		});

		it('says what a token not allowed to write needs', () => {
			const fineGrained = gitRemoteRequestError(
				'GitHub',
				'repos/a/b/git/blobs',
				403,
				'Resource not accessible by personal access token',
				undefined,
				'POST',
			);
			expect(fineGrained.message).toBe(
				'GitHub refused: the token is not allowed to change this repository. A fine-grained token needs « Contents: Read and write » on it, a classic token the « repo » scope. Change the token with « Change token ».',
			);
			expect(fineGrained.status).toBe(403);
			// A classic token without « repo » gets a 404 to a write.
			expect(
				gitRemoteRequestError('GitHub', 'repos/a/b/git/refs', 404, 'Not Found', undefined, 'POST').message,
			).toBe(fineGrained.message);
			// A missing scope is said by the refusal itself (Actions asks for it).
			expect(
				gitRemoteRequestError(
					'GitHub',
					'repos/a/b/contents/.github/workflows/feuillet.yml',
					403,
					'refusing to allow a Personal Access Token to create or update workflow `.github/workflows/feuillet.yml` without `workflow` scope',
					undefined,
					'PUT',
				).message,
			).toMatch(/without `workflow` scope/);
			// A read that finds nothing is not about the token.
			expect(
				gitRemoteRequestError('GitHub', 'repos/a/b/branches/x', 404, 'Not Found', undefined, 'GET').message,
			).toBe("GitHub API request to 'repos/a/b/branches/x' failed (404): Not Found");
		});

		it('says so too for the per-minute limit, without a time when none is given', () => {
			const error = gitRemoteRequestError(
				'GitHub',
				'repos/a/b/git/blobs/x',
				429,
				'You have exceeded a secondary rate limit.',
			);
			expect(error.message).toBe(
				'GitHub limits how many requests an account makes, and this one reached the limit for now. Try again in a few minutes.',
			);
			expect(isRateLimited(error)).toBe(true);
			expect(
				isRateLimited(
					gitRemoteRequestError('GitHub', 'repos/a/b', 403, 'Resource not accessible'),
				),
			).toBe(false);
		});

		it('says plainly when the host refuses the saved token', async () => {
			global.fetch = jest.fn(async () =>
				({
					ok: false,
					status: 401,
					statusText: '',
					json: async () => ({ message: 'Bad credentials' }),
				}) as Response,
			) as typeof fetch;

			const refused = gitRemoteApiRequest({
				providerName: 'GitHub',
				baseUrl: 'https://api.github.com',
				token: 'expired',
				endpoint: 'repos/a/b/branches/main?_=1',
				requestTimeout: 30,
				authHeaders: () => ({}),
			});
			await expect(refused).rejects.toEqual(
				expect.objectContaining({
					message:
						'GitHub refused the saved token: it has expired or was revoked. Connect to GitHub again.',
					status: 401,
				}),
			);
			expect(isRejectedToken(await refused.catch((error) => error))).toBe(true);
			expect(isRejectedToken(new Error('other'))).toBe(false);
			expect(gitRemoteRequestError('GitHub', 'repos/a/b?_=1', 500, 'boom').message).toBe(
				"GitHub API request to 'repos/a/b' failed (500): boom",
			);
		});
	});

	describe('a repository the account cannot see or change', () => {
		const providerWith = (access: GitRepositoryAccess | Error) =>
			({
				displayName: 'GitHub',
				repositoryAccess: jest.fn(async () => {
					if (access instanceof Error) throw access;
					return access;
				}),
				getAccount: jest.fn(async () => ({ login: 'coauteur' })),
			}) as unknown as GitRemoteProvider;
		const notFound = gitRemoteRequestError('GitHub', 'repos/fbastin/these/branches', 404, 'Not Found');

		it("names the account and the repository's owner when it is hidden", async () => {
			const message = await explainRepositoryAccess(
				providerWith({ visible: false, owner: 'fbastin' }),
				'token',
				'fbastin/these',
				undefined,
				notFound,
			);
			expect(message).toContain('(coauteur)');
			expect(message).toContain('fbastin/these');
			expect(message).toContain('Ask its owner, fbastin, to add you as a collaborator');
		});

		it("an organization's: one of its owners", async () => {
			const message = await explainRepositoryAccess(
				providerWith({ visible: false, owner: 'acme', ownerIsOrganization: true }),
				'token',
				'acme/these',
				'coauteur',
				notFound,
			);
			expect(message).toContain('Ask an owner of the acme organization');
		});

		it('a refused push when the account may only read', async () => {
			const refused = gitRemoteRequestError('GitHub', 'repos/fbastin/these/git/refs', 404, 'Not Found', undefined, 'POST');
			const message = await explainRepositoryAccess(
				providerWith({ visible: true, canPush: false, owner: 'fbastin' }),
				'token',
				'fbastin/these',
				'coauteur',
				refused,
			);
			expect(message).toContain('can read the repository fbastin/these but not change it');
		});

		it('not when access is not why: pushing allowed, a token short of rights, one’s own repository, no answer', async () => {
			const refused = gitRemoteRequestError('GitHub', 'repos/fbastin/these/git/refs', 403, 'Resource not accessible by personal access token', undefined, 'POST');
			await expect(
				explainRepositoryAccess(providerWith({ visible: true, canPush: true, owner: 'fbastin' }), 'token', 'fbastin/these', 'coauteur', notFound),
			).resolves.toBeNull();
			await expect(
				explainRepositoryAccess(providerWith({ visible: true, canPush: false, owner: 'fbastin' }), 'token', 'fbastin/these', 'coauteur', refused),
			).resolves.toBeNull();
			await expect(
				explainRepositoryAccess(providerWith({ visible: false, owner: 'fbastin' }), 'token', 'fbastin/these', 'FBastin', notFound),
			).resolves.toBeNull();
			await expect(
				explainRepositoryAccess(providerWith(new Error('offline')), 'token', 'fbastin/these', 'coauteur', notFound),
			).resolves.toBeNull();
		});
	});
});
