import { openOAuthPopup } from '@src/services/OAuthPopup';

const SERVER = 'https://feuillet.example/collab';
const CHANNEL = 'feuillet-google-oauth';

describe('openOAuthPopup', () => {
	let opened: string[];
	let popup: { close: jest.Mock } | null;

	beforeEach(() => {
		opened = [];
		popup = { close: jest.fn() };
		jest
			.spyOn(window, 'open')
			.mockImplementation((url?: string | URL) => {
				opened.push(String(url));
				return popup as unknown as Window;
			});
	});

	afterEach(() => jest.restoreAllMocks());

	const open = () =>
		openOAuthPopup<string>({
			loginUrl: `${SERVER}/google/login`,
			channel: CHANNEL,
			windowName: 'feuillet-google',
			take: (message) =>
				typeof message.ticket === 'string' ? message.ticket : undefined,
			errorText: (error) => `error:${error}`,
			blockedText: 'blocked',
		});

	const post = (data: unknown, origin = 'https://feuillet.example') =>
		window.dispatchEvent(new MessageEvent('message', { data, origin }));

	it('opens the login route with a random state and this origin', () => {
		const attempt = open();
		const url = new URL(opened[0]);
		expect(`${url.origin}${url.pathname}`).toBe(`${SERVER}/google/login`);
		expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(url.searchParams.get('origin')).toBe(window.location.origin);
		attempt.cancel();
		return expect(attempt.result).rejects.toThrow('error:denied');
	});

	it('takes what the server page hands over, for this sign-in only', async () => {
		const attempt = open();
		const state = new URL(opened[0]).searchParams.get('state');
		// Another sign-in's answer, another service's, another origin's.
		post({ type: CHANNEL, state: 'someone-else', ticket: 'a' });
		post({ type: 'feuillet-github-oauth', state, ticket: 'b' });
		post({ type: CHANNEL, state, ticket: 'c' }, 'https://evil.example');
		post({ type: CHANNEL, state, ticket: 'd' });
		await expect(attempt.result).resolves.toBe('d');
	});

	it('says what went wrong', async () => {
		const attempt = open();
		const state = new URL(opened[0]).searchParams.get('state');
		post({ type: CHANNEL, state, error: 'refused' });
		await expect(attempt.result).rejects.toThrow('error:refused');
	});

	it('says when the browser blocked the window', async () => {
		popup = null;
		await expect(open().result).rejects.toThrow('blocked');
	});

	it('closes the window when cancelled', async () => {
		const attempt = open();
		attempt.cancel();
		await expect(attempt.result).rejects.toThrow('error:denied');
		expect(popup?.close).toHaveBeenCalled();
	});
});
