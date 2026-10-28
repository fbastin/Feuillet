// src/services/GitHubOAuthService.ts
import { t } from '@/i18n';

const CHANNEL = 'feuillet-github-oauth';
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

interface OAuthMessage {
	type?: string;
	state?: string;
	token?: string;
	error?: string;
}

export interface GitHubSignIn {
	/** The token, once the user approved Feuillet on GitHub. */
	token: Promise<string>;
	/** Stops waiting, and closes the window when it can. */
	cancel: () => void;
}

const randomState = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
};

const errorText = (error?: string): string => {
	if (error === 'denied') return t('GitHub sign-in was cancelled.');
	if (error === 'expired') {
		return t('The GitHub sign-in took too long. Try again.');
	}
	return t('GitHub did not complete the sign-in. Try again later.');
};

/**
 * "Sign in with GitHub", as on Overleaf: the collaboration server runs
 * GitHub's OAuth flow in a window it opens and hands the token back to this
 * page, which keeps it like a personal access token.
 */
class GitHubOAuthService {
	private availability: Map<string, Promise<boolean>> = new Map();

	/** Whether the collaboration server has a GitHub OAuth App. */
	isAvailable(baseUrl: string): Promise<boolean> {
		if (!baseUrl) return Promise.resolve(false);
		let known = this.availability.get(baseUrl);
		if (!known) {
			known = fetch(`${baseUrl}/github/config`)
				.then((response) => (response.ok ? response.json() : null))
				.then((body) => body?.enabled === true)
				.catch(() => false);
			this.availability.set(baseUrl, known);
			// Asked again later if the server could not say.
			void known.then((enabled) => {
				if (!enabled) this.availability.delete(baseUrl);
			});
		}
		return known;
	}

	signIn(baseUrl: string): GitHubSignIn {
		const state = randomState();
		const login = new URL(`${baseUrl}/github/login`, window.location.href);
		login.searchParams.set('state', state);
		login.searchParams.set('origin', window.location.origin);
		const popup = window.open(
			login.toString(),
			'feuillet-github',
			'popup,width=640,height=760',
		);

		let cancel = () => {};
		const token = new Promise<string>((resolve, reject) => {
			if (!popup) {
				reject(
					new Error(t('Allow pop-ups for this site to sign in with GitHub.')),
				);
				return;
			}
			const serverOrigin = login.origin;
			const channel =
				typeof BroadcastChannel === 'undefined'
					? null
					: new BroadcastChannel(CHANNEL);
			const timer = window.setTimeout(
				() => finish(() => reject(new Error(errorText('expired')))),
				SIGN_IN_TIMEOUT_MS,
			);
			const finish = (settle: () => void) => {
				window.clearTimeout(timer);
				window.removeEventListener('message', onMessage);
				channel?.close();
				settle();
			};
			// Only an answer to this sign-in counts.
			const receive = (data: OAuthMessage) => {
				if (data?.type !== CHANNEL || data.state !== state) return;
				if (data.token) finish(() => resolve(data.token as string));
				else finish(() => reject(new Error(errorText(data.error))));
			};
			const onMessage = (event: MessageEvent) => {
				if (event.origin === serverOrigin) receive(event.data);
			};
			window.addEventListener('message', onMessage);
			channel?.addEventListener('message', (event) => receive(event.data));
			// The window may not report being closed once it went to GitHub,
			// so cancelling is the user's choice, not a guess.
			cancel = () => {
				try {
					popup.close();
				} catch {
					// Out of reach once it went to GitHub.
				}
				finish(() => reject(new Error(errorText('denied'))));
			};
		});
		return { token, cancel: () => cancel() };
	}
}

export const gitHubOAuthService = new GitHubOAuthService();
