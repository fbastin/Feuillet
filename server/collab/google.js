// server/collab/google.js
// "Sign in with Google", as on Overleaf: the server runs Google's OpenID
// Connect flow, because exchanging the code takes the OAuth client's secret,
// and learns which Google account came back: its identifier ("sub"), never
// its address, name or picture (the scope is `openid` alone). The page that
// asked gets a ticket for it, not the identifier; the account server
// (accounts.js) takes the ticket to sign in to the account that Google
// account was linked to, to link it, or to create an account linked to it.
//
//   GET /google/config                    -> {enabled}
//   GET /google/login?state=&origin=      -> redirect to Google
//   GET /google/callback?code=&state=     -> a page that gives the ticket (or
//                                            the error) to the Feuillet page
//
// The Feuillet page opens /google/login in a popup with a random state and
// its origin, which must be an allowed one. The callback page posts
// {type: 'feuillet-google-oauth', state, ticket | error} to that origin, and
// on the same broadcast channel (a popup that went through Google may no
// longer reach its opener). The page keeps only a message whose state it
// chose. The code is exchanged with PKCE, and the ID token, which comes
// straight from Google's token endpoint over TLS, must name this client,
// Google, the nonce sent, and not be expired.

const crypto = require('node:crypto');

const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const TICKET = /^[A-Za-z0-9_-]{43}$/;
// Google's subject identifiers: at most 255 ASCII characters.
const SUBJECT = /^[\x21-\x7e]{1,255}$/;
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const PENDING_MS = 10 * 60 * 1000;
const TICKET_MS = 10 * 60 * 1000;
const MAX_PENDING = 1000;
const MAX_TICKETS = 1000;
const CHANNEL = 'feuillet-google-oauth';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const randomText = () => crypto.randomBytes(32).toString('base64url');

/** What an account keeps of a Google account: a hash of its identifier. */
const identityOf = (subject) => sha256(`google:${subject}`);

// The claims of an ID token, unchecked.
const claimsOf = (idToken) => {
	const parts = typeof idToken === 'string' ? idToken.split('.') : [];
	if (parts.length !== 3) return null;
	try {
		return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
	} catch {
		return null;
	}
};

const createGoogle = ({
	clientId,
	clientSecret,
	publicUrl,
	// Google's addresses, replaced in tests.
	authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth',
	tokenUrl = 'https://oauth2.googleapis.com/token',
	isAllowedOrigin,
	log,
}) => {
	const enabled = Boolean(clientId && clientSecret && publicUrl);
	const callbackUrl = `${(publicUrl ?? '').replace(/\/$/, '')}/google/callback`;
	// Sign-ins started here, by state; then the tickets they gave.
	const pending = new Map();
	const tickets = new Map();

	const forget = () => {
		const now = Date.now();
		for (const [state, entry] of pending) {
			if (entry.expires <= now) pending.delete(state);
		}
		for (const [ticket, entry] of tickets) {
			if (entry.expires <= now) tickets.delete(ticket);
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

	// The page Google sends the user back to: it hands over the result and
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
			"? 'La connexion avec Google a échoué. Vous pouvez fermer cette fenêtre.'",
			": 'Google a confirmé votre compte. Cette fenêtre va se fermer.';",
			'setTimeout(function () { window.close(); }, 500);',
			'})();',
		].join('\n');
		const hash = crypto.createHash('sha256').update(script).digest('base64');
		const body = [
			'<!doctype html><html lang="fr"><head><meta charset="utf-8">',
			'<title>Google · Feuillet</title></head>',
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
		const verifier = randomText();
		const nonce = randomText();
		pending.set(state, {
			origin,
			verifier,
			nonce,
			expires: Date.now() + PENDING_MS,
		});
		const authorize = new URL(authorizeUrl);
		authorize.searchParams.set('client_id', clientId);
		authorize.searchParams.set('redirect_uri', callbackUrl);
		authorize.searchParams.set('response_type', 'code');
		authorize.searchParams.set('scope', 'openid');
		authorize.searchParams.set('state', state);
		authorize.searchParams.set('nonce', nonce);
		authorize.searchParams.set(
			'code_challenge',
			crypto.createHash('sha256').update(verifier).digest('base64url'),
		);
		authorize.searchParams.set('code_challenge_method', 'S256');
		// Whoever has several Google accounts chooses one each time.
		authorize.searchParams.set('prompt', 'select_account');
		res.writeHead(302, {
			Location: authorize.toString(),
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer',
		});
		res.end();
	};

	// The Google account the token endpoint's answer names, once checked.
	const subjectOf = (result, nonce) => {
		const claims = claimsOf(result?.id_token);
		if (!claims) return null;
		const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
		if (!ISSUERS.has(claims.iss)) return null;
		if (!audience.includes(clientId)) return null;
		if (audience.length > 1 && claims.azp !== clientId) return null;
		if (!(Number(claims.exp) * 1000 > Date.now())) return null;
		if (claims.nonce !== nonce) return null;
		return typeof claims.sub === 'string' && SUBJECT.test(claims.sub)
			? claims.sub
			: null;
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
			const response = await fetch(tokenUrl, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: params.get('code') ?? '',
					client_id: clientId,
					client_secret: clientSecret,
					redirect_uri: callbackUrl,
					code_verifier: entry.verifier,
				}),
				signal: AbortSignal.timeout(15000),
			});
			const result = await response.json().catch(() => ({}));
			const subject = response.ok ? subjectOf(result, entry.nonce) : null;
			if (!subject) {
				log(
					'Google sign-in refused',
					response.status,
					typeof result?.error === 'string' ? result.error.slice(0, 50) : '',
				);
				resultPage(res, entry.origin, { state, error: 'refused' });
				return;
			}
			forget();
			if (tickets.size >= MAX_TICKETS) {
				resultPage(res, entry.origin, { state, error: 'busy' });
				return;
			}
			const ticket = randomText();
			tickets.set(ticket, {
				identity: identityOf(subject),
				expires: Date.now() + TICKET_MS,
			});
			log('Google sign-in completed');
			resultPage(res, entry.origin, { state, ticket });
		} catch (error) {
			log('Google sign-in failed', error.message);
			resultPage(res, entry.origin, { state, error: 'unreachable' });
		}
	};

	/**
	 * The Google account a ticket stands for (as identityOf gives it), or
	 * null; a ticket serves once, when `use` is set.
	 */
	const identityFor = (ticket, { use = false } = {}) => {
		if (typeof ticket !== 'string' || !TICKET.test(ticket)) return null;
		const entry = tickets.get(ticket);
		if (!entry || entry.expires <= Date.now()) {
			tickets.delete(ticket);
			return null;
		}
		if (use) tickets.delete(ticket);
		return entry.identity;
	};

	const handles = (url) => url.startsWith('/google/');

	const handle = (req, res, url, params) => {
		if (req.method !== 'GET') {
			req.resume();
			send(res, 405, 'text/plain', 'Method not allowed\n', { Allow: 'GET' });
			return;
		}
		req.resume();
		if (url === '/google/config') {
			send(res, 200, 'application/json', JSON.stringify({ enabled }));
			return;
		}
		if (!enabled) {
			send(res, 404, 'text/plain', 'Not found\n');
			return;
		}
		if (url === '/google/login') {
			login(res, params);
			return;
		}
		if (url === '/google/callback') {
			void callback(res, params);
			return;
		}
		send(res, 404, 'text/plain', 'Not found\n');
	};

	return { enabled, handles, handle, identityFor };
};

module.exports = { createGoogle, identityOf };
