import {
	gitRemoteApiRequest,
	gitRemoteRequestError,
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
});
