// src/services/OAuthPopup.ts
// The window in which the collaboration server runs a sign-in with another
// service (GitHub, Google): it opens the server's login route with a random
// state and this page's origin, and waits for the callback page's message,
// posted to this page or on a broadcast channel (a window that went through
// the other service may no longer reach its opener). Only a message with the
// state chosen here counts.

const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export interface OAuthMessage {
	type?: string;
	state?: string;
	error?: string;
	[field: string]: unknown;
}

export interface OAuthPopup<T> {
	/** What the callback page handed over, once the user agreed. */
	result: Promise<T>;
	/** Stops waiting, and closes the window when it can. */
	cancel: () => void;
}

export const randomState = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
};

export function openOAuthPopup<T>({
	loginUrl,
	channel: channelName,
	windowName,
	take,
	errorText,
	blockedText,
}: {
	/** The server's login route, e.g. `${server}/github/login`. */
	loginUrl: string;
	/** The `type` of the callback page's message, and its channel's name. */
	channel: string;
	windowName: string;
	/** What the message hands over, or undefined if it has nothing. */
	take: (message: OAuthMessage) => T | undefined;
	/** What to say of an error code ('denied', 'expired'...). */
	errorText: (error?: string) => string;
	/** What to say when the browser blocked the window. */
	blockedText: string;
}): OAuthPopup<T> {
	const state = randomState();
	const login = new URL(loginUrl, window.location.href);
	login.searchParams.set('state', state);
	login.searchParams.set('origin', window.location.origin);
	const popup = window.open(
		login.toString(),
		windowName,
		'popup,width=640,height=760',
	);

	let cancel = () => {};
	const result = new Promise<T>((resolve, reject) => {
		if (!popup) {
			reject(new Error(blockedText));
			return;
		}
		const serverOrigin = login.origin;
		const channel =
			typeof BroadcastChannel === 'undefined'
				? null
				: new BroadcastChannel(channelName);
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
			if (data?.type !== channelName || data.state !== state) return;
			const value = take(data);
			if (value !== undefined) finish(() => resolve(value));
			else finish(() => reject(new Error(errorText(data.error))));
		};
		const onMessage = (event: MessageEvent) => {
			if (event.origin === serverOrigin) receive(event.data);
		};
		window.addEventListener('message', onMessage);
		channel?.addEventListener('message', (event) => receive(event.data));
		// The window may not report being closed once it went to the other
		// service, so cancelling is the user's choice, not a guess.
		cancel = () => {
			try {
				popup.close();
			} catch {
				// Out of reach once it went to the other service.
			}
			finish(() => reject(new Error(errorText('denied'))));
		};
	});
	return { result, cancel: () => cancel() };
}

/** Whether a server route answers {enabled: true}, asked again when not. */
export function availabilityCache(
	path: string,
): (baseUrl: string) => Promise<boolean> {
	const known = new Map<string, Promise<boolean>>();
	return (baseUrl: string) => {
		if (!baseUrl) return Promise.resolve(false);
		let answer = known.get(baseUrl);
		if (!answer) {
			answer = fetch(`${baseUrl}${path}`)
				.then((response) => (response.ok ? response.json() : null))
				.then((body) => body?.enabled === true)
				.catch(() => false);
			known.set(baseUrl, answer);
			// Asked again later if the server could not say.
			void answer.then((enabled) => {
				if (!enabled) known.delete(baseUrl);
			});
		}
		return answer;
	};
}
