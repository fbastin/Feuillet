// server/collab/github.js
// "Sign in with GitHub", as on Overleaf: the server runs GitHub's OAuth web
// flow, because exchanging the code for a token takes the OAuth App's
// secret, and hands the token to the Feuillet page that asked for it. The
// token is not kept here: the browser encrypts and stores it, as it does a
// personal access token.
//
//   GET /github/config                    -> {enabled}
//   GET /github/login?state=&origin=      -> redirect to GitHub
//   GET /github/callback?code=&state=     -> a page that gives the token (or
//                                            the error) to the Feuillet page
//
// The Feuillet page opens /github/login in a popup with a random state and
// its origin, which must be an allowed one. The callback page posts
// {type: 'feuillet-github-oauth', state, token | error} to that origin, and
// on the same broadcast channel (when the server and the app share an
// origin, a popup that went through GitHub may no longer reach its opener).
// The page keeps only a message whose state it chose.

const crypto = require('node:crypto');

const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const PENDING_MS = 10 * 60 * 1000;
const MAX_PENDING = 1000;
const CHANNEL = 'feuillet-github-oauth';

const createGitHub = ({
	clientId,
	clientSecret,
	publicUrl,
	oauthUrl = 'https://github.com',
	isAllowedOrigin,
	log,
}) => {
	const enabled = Boolean(clientId && clientSecret && publicUrl);
	const callbackUrl = `${(publicUrl ?? '').replace(/\/$/, '')}/github/callback`;
	const base = oauthUrl.replace(/\/$/, '');
	// Logins started here, by state: the origin to hand the token to.
	const pending = new Map();

	const forget = () => {
		const now = Date.now();
		for (const [state, entry] of pending) {
			if (entry.expires <= now) pending.delete(state);
		}
	};
	setInterval(forget, PENDING_MS).unref();

	const originOf = (value) => {
		try {
			const url = new URL(value);
			return /^https?:$/.test(url.protocol) && url.origin === value
				? value
				: null;
		} catch {
			return null;
		}
	};

	const send = (res, status, type, body, headers = {}) => {
		res.writeHead(status, {
			'Content-Type': type,
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer',
			'X-Content-Type-Options': 'nosniff',
			...headers,
		});
		res.end(body);
	};

	// The page GitHub sends the user back to: it hands over the result and
	// closes.
	const resultPage = (res, origin, message) => {
		const data = JSON.stringify({ type: CHANNEL, ...message }).replace(
			/</g,
			'\\u003c',
		);
		const target = JSON.stringify(origin ?? '').replace(/</g, '\\u003c');
		const script = [
			'(function () {',
			`var d = ${data}, o = ${target};`,
			'try { if (window.opener && o) window.opener.postMessage(d, o); }',
			'catch (e) {}',
			`try { var c = new BroadcastChannel('${CHANNEL}');`,
			'c.postMessage(d); c.close(); } catch (e) {}',
			"document.getElementById('m').textContent = d.error",
			"? 'La connexion à GitHub a échoué. Vous pouvez fermer cette fenêtre.'",
			": 'Connecté à GitHub. Cette fenêtre va se fermer.';",
			'setTimeout(function () { window.close(); }, 500);',
			'})();',
		].join('\n');
		const hash = crypto.createHash('sha256').update(script).digest('base64');
		const body = [
			'<!doctype html><html lang="fr"><head><meta charset="utf-8">',
			'<title>GitHub · Feuillet</title></head>',
			`<body><p id="m"></p><script>${script}</script></body></html>`,
		].join('');
		send(res, 200, 'text/html; charset=utf-8', body, {
			'Content-Security-Policy': [
				"default-src 'none'",
				`script-src 'sha256-${hash}'`,
				"frame-ancestors 'none'",
			].join('; '),
		});
	};

	const login = (res, params) => {
		const state = params.get('state') ?? '';
		const origin = originOf(params.get('origin') ?? '');
		if (!STATE.test(state) || !origin || !isAllowedOrigin(origin)) {
			send(res, 400, 'text/plain', 'Bad request\n');
			return;
		}
		forget();
		if (pending.size >= MAX_PENDING) {
			send(res, 503, 'text/plain', 'Too many sign-ins in progress\n');
			return;
		}
		pending.set(state, { origin, expires: Date.now() + PENDING_MS });
		const authorize = new URL(`${base}/login/oauth/authorize`);
		authorize.searchParams.set('client_id', clientId);
		authorize.searchParams.set('redirect_uri', callbackUrl);
		authorize.searchParams.set('scope', 'repo');
		authorize.searchParams.set('state', state);
		authorize.searchParams.set('allow_signup', 'false');
		res.writeHead(302, {
			Location: authorize.toString(),
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer',
		});
		res.end();
	};

	const callback = async (res, params) => {
		const state = params.get('state') ?? '';
		const entry = STATE.test(state) ? pending.get(state) : undefined;
		pending.delete(state);
		if (!entry || entry.expires <= Date.now()) {
			resultPage(res, null, { state, error: 'expired' });
			return;
		}
		if (params.get('error')) {
			resultPage(res, entry.origin, { state, error: 'denied' });
			return;
		}
		try {
			const response = await fetch(`${base}/login/oauth/access_token`, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					client_id: clientId,
					client_secret: clientSecret,
					code: params.get('code') ?? '',
					redirect_uri: callbackUrl,
				}),
				signal: AbortSignal.timeout(15000),
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok || typeof result.access_token !== 'string') {
				log('GitHub sign-in refused', response.status, result.error ?? '');
				resultPage(res, entry.origin, { state, error: 'refused' });
				return;
			}
			log('GitHub sign-in completed');
			resultPage(res, entry.origin, { state, token: result.access_token });
		} catch (error) {
			log('GitHub sign-in failed', error.message);
			resultPage(res, entry.origin, { state, error: 'unreachable' });
		}
	};

	const handles = (url) => url.startsWith('/github/');

	const handle = (req, res, url, params) => {
		if (req.method !== 'GET') {
			req.resume();
			send(res, 405, 'text/plain', 'Method not allowed\n', { Allow: 'GET' });
			return;
		}
		req.resume();
		if (url === '/github/config') {
			send(res, 200, 'application/json', JSON.stringify({ enabled }));
			return;
		}
		if (!enabled) {
			send(res, 404, 'text/plain', 'Not found\n');
			return;
		}
		if (url === '/github/login') {
			login(res, params);
			return;
		}
		if (url === '/github/callback') {
			void callback(res, params);
			return;
		}
		send(res, 404, 'text/plain', 'Not found\n');
	};

	return { enabled, handles, handle };
};

module.exports = { createGitHub };
