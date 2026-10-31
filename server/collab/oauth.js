// server/collab/oauth.js
// Lets an assistant such as Claude work on an account's projects (mcp.js),
// once the account agrees, through OAuth 2.1 as the Model Context Protocol
// asks (modelcontextprotocol.io/specification/2025-11-25/basic/authorization):
//
//   GET  /.well-known/oauth-protected-resource[/...]   what protects /mcp
//                                                       (RFC 9728)
//   GET  /.well-known/oauth-authorization-server[/...] this server's
//   GET  /.well-known/openid-configuration[/...]       endpoints (RFC 8414)
//   POST /oauth/register {redirect_uris, client_name}  -> the application's
//                                                       client id (RFC 7591)
//   GET  /oauth/authorize    the page where one signs in and agrees, or not
//   POST /oauth/token        authorization_code (PKCE S256) or refresh_token
//   GET  /oauth/connections  (account token) -> {connections}: who may
//                            work on the account's projects
//   POST /oauth/connections {revoke}   (account token): no longer
//
// Applications register themselves, and may send people back only to Claude
// (claude.ai, claude.com), to a program on the same computer (Claude Code,
// RFC 8252) or to MCP_REDIRECT_URIS. Access tokens last an hour; refresh
// tokens, replaced at each use, 30 days without use. What an account
// granted ends when it disconnects the application, changes its password or
// is deleted.
//
// MCP_DIR keeps clients/<client>.json and grants/<grant>.json, with tokens
// as SHA-256 hashes; codes and pending requests stay in memory.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACCESS_MS = 60 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_MS = 5 * 60 * 1000;
const REQUEST_MS = 30 * 60 * 1000;
const CLIENT_UNUSED_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_REGISTRATIONS_PER_HOUR = 30;
const MAX_CLIENTS = 5000;
const SCOPE = 'projects';
const CLAUDE_REDIRECTS = [
	'https://claude.ai/api/mcp/auth_callback',
	'https://claude.com/api/mcp/auth_callback',
];
const LOOPBACK =
	/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?(\/[^\s#]*)?$/;
const CLIENT_ID = /^[0-9a-f]{32}$/;
const GRANT_ID = /^[0-9a-f]{32}$/;
const TOKEN = /^(fa|fr)_([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;

class HttpError extends Error {
	constructor(status, code, description) {
		super(code);
		this.status = status;
		this.code = code;
		this.description = description;
	}
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
const escapeHtml = (text) =>
	String(text).replace(
		/[&<>"']/g,
		(char) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
				char
			],
	);
const sameUrl = (a, b) =>
	String(a ?? '').replace(/\/+$/, '').toLowerCase() ===
	String(b ?? '').replace(/\/+$/, '').toLowerCase();

// The page's words, in French for those who read French.
const WORDS = {
	en: {
		title: 'Connect an application to Feuillet',
		asks: (name) =>
			`<strong>${name}</strong> asks to work on your Feuillet projects.`,
		can: 'It will be able to list and read your projects, compile them, and suggest changes and comments, as far as your role in each project allows. Its changes appear as tracked changes, which you accept or reject.',
		back: (where) => `You will then go back to ${where}.`,
		program: (port) => `a program on this computer (port ${port})`,
		username: 'Feuillet username',
		password: 'Password',
		allow: 'Allow',
		deny: 'Deny',
		revoke:
			'You can disconnect it at any time in your Feuillet profile, under Assistants.',
		expired: 'This request has expired. Start again from the application.',
		invalid: 'This request is not valid',
		errors: {
			unknown_username: 'There is no account with this username.',
			wrong_password: 'Wrong password.',
			too_many_attempts: 'Too many attempts. Try again in 15 minutes.',
			invalid_credentials: 'Enter your username and password.',
		},
	},
	fr: {
		title: 'Connecter une application à Feuillet',
		asks: (name) =>
			`<strong>${name}</strong> demande à travailler sur vos projets Feuillet.`,
		can: 'Elle pourra lister et lire vos projets, les compiler, et proposer des modifications et des commentaires, selon votre rôle dans chaque projet. Ses modifications arrivent en modifications suivies, que vous acceptez ou refusez.',
		back: (where) => `Vous retournerez ensuite à ${where}.`,
		program: (port) => `un programme de cet ordinateur (port ${port})`,
		username: "Nom d'utilisateur Feuillet",
		password: 'Mot de passe',
		allow: 'Autoriser',
		deny: 'Refuser',
		revoke:
			'Vous pouvez la déconnecter en tout temps dans votre profil Feuillet, sous Assistants.',
		expired: "Cette demande a expiré. Recommencez depuis l'application.",
		invalid: "Cette demande n'est pas valide",
		errors: {
			unknown_username: "Aucun compte ne porte ce nom d'utilisateur.",
			wrong_password: 'Mot de passe incorrect.',
			too_many_attempts: 'Trop de tentatives. Réessayez dans 15 minutes.',
			invalid_credentials: "Entrez votre nom d'utilisateur et votre mot de passe.",
		},
	},
};

const wordsFor = (req) =>
	/^\s*fr\b/i.test(String(req.headers['accept-language'] ?? ''))
		? WORDS.fr
		: WORDS.en;

const STYLE = `
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f5f7;color:#1f2328;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{background:#fff;border:1px solid #d8dde3;border-radius:10px;max-width:440px;width:calc(100% - 32px);padding:28px 28px 22px;box-shadow:0 4px 18px rgba(0,0,0,.06)}
h1{font-size:1.15rem;margin:0 0 14px}
p{line-height:1.45;margin:0 0 12px;font-size:.95rem}
.note{color:#59636e;font-size:.85rem}
.error{background:#fdecec;border:1px solid #f1b5b5;color:#9b1c1c;padding:8px 10px;border-radius:6px}
label{display:block;font-size:.85rem;margin:12px 0 4px;color:#3d444d}
input{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid #c5ccd3;border-radius:6px;font-size:.95rem}
.actions{display:flex;gap:10px;margin:18px 0 12px}
button{padding:8px 16px;border-radius:6px;border:1px solid #c5ccd3;background:#fff;font-size:.95rem;cursor:pointer}
button.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
`;

const page = (title, body) =>
	`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;

const createOAuth = ({
	dir,
	publicUrl,
	accounts,
	log,
	redirectUris = [],
}) => {
	const clientsDir = path.join(dir, 'clients');
	const grantsDir = path.join(dir, 'grants');
	fs.mkdirSync(clientsDir, { recursive: true });
	fs.mkdirSync(grantsDir, { recursive: true });
	const allowedRedirects = new Set([...CLAUDE_REDIRECTS, ...redirectUris]);

	// Codes by hash, pending requests by id, registrations by address.
	const codes = new Map();
	const requests = new Map();
	const registrations = new Map();

	const readJson = (file) => {
		try {
			return JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch (error) {
			if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
			throw error;
		}
	};
	const writeJson = (file, value) => {
		const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
		fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
		fs.renameSync(temp, file);
	};
	const clientPath = (id) => path.join(clientsDir, `${id}.json`);
	const grantPath = (id) => path.join(grantsDir, `${id}.json`);
	const readClient = (id) =>
		CLIENT_ID.test(String(id)) ? readJson(clientPath(id)) : null;
	const readGrant = (id) =>
		GRANT_ID.test(String(id)) ? readJson(grantPath(id)) : null;
	const removeGrant = (id) => fs.rmSync(grantPath(id), { force: true });

	const baseUrl = (req) =>
		(publicUrl || `http://${req.headers.host}`).replace(/\/+$/, '');
	const resourceUrl = (req) => `${baseUrl(req)}/mcp`;

	const allowedRedirect = (uri) =>
		typeof uri === 'string' &&
		uri.length <= 500 &&
		(LOOPBACK.test(uri) || allowedRedirects.has(uri));
	// Programs on the same computer listen on whatever port is free.
	const sameRedirect = (registered, requested) => {
		if (registered === requested) return true;
		const a = LOOPBACK.exec(registered);
		const b = LOOPBACK.exec(requested);
		return Boolean(a && b && a[1] === b[1] && (a[3] ?? '') === (b[3] ?? ''));
	};
	const destination = (words, uri) => {
		const loopback = LOOPBACK.exec(uri);
		return loopback
			? words.program(loopback[2] ?? '80')
			: escapeHtml(new URL(uri).host);
	};

	// Applications call from anywhere, with tokens rather than cookies; the
	// account's own requests get server.js's origin checks instead.
	const reply = (res, status, body, headers = {}, { anyOrigin = true } = {}) => {
		res.writeHead(status, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			...(anyOrigin ? { 'Access-Control-Allow-Origin': '*' } : {}),
			...headers,
		});
		res.end(body === undefined ? '' : JSON.stringify(body));
	};
	const html = (res, status, title, body) => {
		res.writeHead(status, {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Content-Security-Policy':
				"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
			'X-Frame-Options': 'DENY',
			'Referrer-Policy': 'no-referrer',
		});
		res.end(page(title, body));
	};
	const redirect = (res, uri, params) => {
		const target = new URL(uri);
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null && value !== '') {
				target.searchParams.set(key, value);
			}
		}
		res.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' });
		res.end();
	};

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			let size = 0;
			const chunks = [];
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					reject(new HttpError(413, 'invalid_request', 'Request too large'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				if (/json/i.test(String(req.headers['content-type'] ?? ''))) {
					try {
						const body = text ? JSON.parse(text) : {};
						resolve(body && typeof body === 'object' ? body : {});
					} catch {
						reject(new HttpError(400, 'invalid_request', 'Malformed JSON'));
					}
					return;
				}
				resolve(Object.fromEntries(new URLSearchParams(text)));
			});
			req.on('error', () =>
				reject(new HttpError(400, 'invalid_request', 'Interrupted')),
			);
		});

	// ---- Discovery

	const protectedResource = (req) => ({
		resource: resourceUrl(req),
		authorization_servers: [baseUrl(req)],
		scopes_supported: [SCOPE],
		bearer_methods_supported: ['header'],
		resource_name: 'Feuillet',
	});

	const authorizationServer = (req) => {
		const base = baseUrl(req);
		return {
			issuer: base,
			authorization_endpoint: `${base}/oauth/authorize`,
			token_endpoint: `${base}/oauth/token`,
			registration_endpoint: `${base}/oauth/register`,
			scopes_supported: [SCOPE],
			response_types_supported: ['code'],
			response_modes_supported: ['query'],
			grant_types_supported: ['authorization_code', 'refresh_token'],
			token_endpoint_auth_methods_supported: ['none'],
			code_challenge_methods_supported: ['S256'],
			authorization_response_iss_parameter_supported: true,
		};
	};

	/** What a 401 from /mcp says, so that applications find how to sign in. */
	const challenge = (req, error) =>
		`Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource", scope="${SCOPE}"${error ? `, error="${error}"` : ''}`;

	// ---- Registration

	const register = (req, body) => {
		const address = accounts.clientAddress(req);
		const now = Date.now();
		const recent = (registrations.get(address) ?? []).filter(
			(time) => now - time < 60 * 60 * 1000,
		);
		if (recent.length >= MAX_REGISTRATIONS_PER_HOUR) {
			throw new HttpError(429, 'invalid_client_metadata', 'Too many registrations');
		}
		recent.push(now);
		registrations.set(address, recent);
		if (fs.readdirSync(clientsDir).length >= MAX_CLIENTS) {
			throw new HttpError(503, 'invalid_client_metadata', 'Too many clients');
		}

		const uris = body.redirect_uris;
		if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
			throw new HttpError(400, 'invalid_redirect_uri', 'redirect_uris is required');
		}
		const refused = uris.find((uri) => !allowedRedirect(uri));
		if (refused !== undefined) {
			throw new HttpError(
				400,
				'invalid_redirect_uri',
				`Redirect URI not allowed: ${String(refused).slice(0, 200)}`,
			);
		}
		const name =
			typeof body.client_name === 'string' && body.client_name.trim()
				? body.client_name.trim().slice(0, 100)
				: 'Application';
		const client = {
			client_id: crypto.randomBytes(16).toString('hex'),
			client_name: name,
			redirect_uris: uris,
			createdAt: now,
		};
		writeJson(clientPath(client.client_id), client);
		log('application registered', JSON.stringify(name));
		return {
			client_id: client.client_id,
			client_id_issued_at: Math.floor(now / 1000),
			client_name: name,
			redirect_uris: uris,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
		};
	};

	// ---- Authorization page

	const consentPage = (req, res, request, error = '') => {
		const words = wordsFor(req);
		const message = error
			? `<p class="error">${escapeHtml(words.errors[error] ?? error)}</p>`
			: '';
		html(
			res,
			error ? 400 : 200,
			words.title,
			`<h1>${words.title}</h1>${message}
<p>${words.asks(escapeHtml(request.clientName))}</p>
<p>${words.can}</p>
<p class="note">${words.back(destination(words, request.redirectUri))}</p>
<form method="post" action="authorize">
<input type="hidden" name="request" value="${escapeHtml(request.id)}">
<label for="username">${words.username}</label>
<input id="username" name="username" autocomplete="username" required value="${escapeHtml(request.username ?? '')}">
<label for="password">${words.password}</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<div class="actions"><button class="primary" name="decision" value="allow">${words.allow}</button><button name="decision" value="deny" formnovalidate>${words.deny}</button></div>
</form>
<p class="note">${words.revoke}</p>`,
		);
	};

	const invalidPage = (req, res, detail) => {
		const words = wordsFor(req);
		html(
			res,
			400,
			words.invalid,
			`<h1>${words.invalid}</h1><p class="note">${escapeHtml(detail)}</p>`,
		);
	};

	const startAuthorization = (req, res, params) => {
		const client = readClient(params.get('client_id'));
		if (!client) {
			invalidPage(req, res, 'Unknown client_id.');
			return;
		}
		let redirectUri = params.get('redirect_uri');
		if (!redirectUri && client.redirect_uris.length === 1) {
			redirectUri = client.redirect_uris[0];
		}
		if (
			!redirectUri ||
			!allowedRedirect(redirectUri) ||
			!client.redirect_uris.some((uri) => sameRedirect(uri, redirectUri))
		) {
			invalidPage(req, res, 'redirect_uri does not match the registered ones.');
			return;
		}
		const state = params.get('state') ?? undefined;
		const fail = (error, description) =>
			redirect(res, redirectUri, {
				error,
				error_description: description,
				state,
				iss: baseUrl(req),
			});
		if (params.get('response_type') !== 'code') {
			fail('unsupported_response_type', 'Only the code flow is supported');
			return;
		}
		const challengeValue = params.get('code_challenge');
		if (
			!challengeValue ||
			!/^[A-Za-z0-9_-]{43,128}$/.test(challengeValue) ||
			params.get('code_challenge_method') !== 'S256'
		) {
			fail('invalid_request', 'PKCE with S256 is required');
			return;
		}
		const resource = params.get('resource');
		if (resource && !sameUrl(resource, resourceUrl(req))) {
			fail('invalid_target', 'Unknown resource');
			return;
		}
		const request = {
			id: crypto.randomBytes(24).toString('hex'),
			clientId: client.client_id,
			clientName: client.client_name,
			redirectUri,
			codeChallenge: challengeValue,
			state,
			scope: params.get('scope') || SCOPE,
			expiresAt: Date.now() + REQUEST_MS,
		};
		requests.set(request.id, request);
		consentPage(req, res, request);
	};

	const finishAuthorization = async (req, res, body) => {
		const request = requests.get(String(body.request ?? ''));
		if (!request || request.expiresAt < Date.now()) {
			const words = wordsFor(req);
			invalidPage(req, res, words.expired);
			return;
		}
		const back = (params) => {
			requests.delete(request.id);
			redirect(res, request.redirectUri, {
				...params,
				state: request.state,
				iss: baseUrl(req),
			});
		};
		if (body.decision !== 'allow') {
			back({ error: 'access_denied', error_description: 'Denied' });
			return;
		}
		let account;
		try {
			account = await accounts.verifyCredentials(
				body.username,
				body.password,
				accounts.clientAddress(req),
			);
		} catch (error) {
			if (typeof error?.code !== 'string' || !Number.isInteger(error.status)) {
				throw error;
			}
			consentPage(
				req,
				res,
				{ ...request, username: String(body.username ?? '').slice(0, 64) },
				error.code,
			);
			return;
		}
		const code = secret();
		codes.set(sha256(code), {
			clientId: request.clientId,
			clientName: request.clientName,
			redirectUri: request.redirectUri,
			codeChallenge: request.codeChallenge,
			scope: request.scope,
			accountId: account.id,
			stamp: account.stamp,
			expiresAt: Date.now() + CODE_MS,
		});
		const client = readClient(request.clientId);
		if (client && !client.authorizedAt) {
			writeJson(clientPath(client.client_id), {
				...client,
				authorizedAt: Date.now(),
			});
		}
		log('application authorized', JSON.stringify(request.clientName));
		back({ code });
	};

	// ---- Tokens

	const issue = (grant) => {
		const now = Date.now();
		const access = secret();
		const refresh = secret();
		grant.access = [
			{ hash: sha256(access), expiresAt: now + ACCESS_MS },
			// The previous one keeps working until it expires, for requests
			// already on their way.
			...(grant.access ?? []).filter((token) => token.expiresAt > now),
		].slice(0, 3);
		grant.refresh = { hash: sha256(refresh), expiresAt: now + REFRESH_MS };
		grant.lastUsedAt = now;
		writeJson(grantPath(grant.id), grant);
		return {
			access_token: `fa_${grant.id}.${access}`,
			token_type: 'Bearer',
			expires_in: Math.floor(ACCESS_MS / 1000),
			refresh_token: `fr_${grant.id}.${refresh}`,
			scope: grant.scope,
		};
	};

	// The account a grant still holds, or null, the grant then removed.
	const accountOf = (grant) => {
		const account = accounts.accountById(grant.accountId);
		if (account && account.stamp === grant.stamp) return account;
		removeGrant(grant.id);
		return null;
	};

	const token = (req, body) => {
		const resource = body.resource;
		if (resource && !sameUrl(resource, resourceUrl(req))) {
			throw new HttpError(400, 'invalid_target', 'Unknown resource');
		}
		if (body.grant_type === 'authorization_code') {
			const hash = sha256(String(body.code ?? ''));
			const entry = codes.get(hash);
			codes.delete(hash);
			if (!entry || entry.expiresAt < Date.now()) {
				throw new HttpError(400, 'invalid_grant', 'Unknown or expired code');
			}
			if (body.client_id && body.client_id !== entry.clientId) {
				throw new HttpError(400, 'invalid_grant', 'Code issued to another client');
			}
			if (body.redirect_uri !== entry.redirectUri) {
				throw new HttpError(400, 'invalid_grant', 'redirect_uri does not match');
			}
			const verifier = String(body.code_verifier ?? '');
			if (
				!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
				crypto.createHash('sha256').update(verifier).digest('base64url') !==
					entry.codeChallenge
			) {
				throw new HttpError(400, 'invalid_grant', 'code_verifier does not match');
			}
			const grant = {
				id: crypto.randomBytes(16).toString('hex'),
				accountId: entry.accountId,
				stamp: entry.stamp,
				clientId: entry.clientId,
				clientName: entry.clientName,
				scope: entry.scope,
				createdAt: Date.now(),
			};
			if (!accountOf(grant)) {
				throw new HttpError(400, 'invalid_grant', 'Account no longer available');
			}
			return issue(grant);
		}
		if (body.grant_type === 'refresh_token') {
			const match = TOKEN.exec(String(body.refresh_token ?? ''));
			const grant = match?.[1] === 'fr' ? readGrant(match[2]) : null;
			if (
				!grant ||
				grant.refresh?.hash !== sha256(match[3]) ||
				grant.refresh.expiresAt < Date.now() ||
				(body.client_id && body.client_id !== grant.clientId)
			) {
				throw new HttpError(400, 'invalid_grant', 'Unknown or expired refresh token');
			}
			if (!accountOf(grant)) {
				throw new HttpError(400, 'invalid_grant', 'Access was withdrawn');
			}
			return issue(grant);
		}
		throw new HttpError(400, 'unsupported_grant_type', 'Unsupported grant_type');
	};

	/**
	 * The account behind a request's access token, with the grant, or an
	 * error to answer with.
	 */
	const authenticate = (req) => {
		const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
		if (!match) return { error: null };
		const parts = TOKEN.exec(match[1]);
		const grant = parts?.[1] === 'fa' ? readGrant(parts[2]) : null;
		const now = Date.now();
		const hash = parts ? sha256(parts[3]) : '';
		if (
			!grant ||
			!(grant.access ?? []).some(
				(token) => token.hash === hash && token.expiresAt > now,
			)
		) {
			return { error: 'invalid_token' };
		}
		const account = accountOf(grant);
		if (!account) return { error: 'invalid_token' };
		if (now - (grant.lastUsedAt ?? 0) > TOUCH_MS) {
			writeJson(grantPath(grant.id), { ...grant, lastUsedAt: now });
		}
		return { grant, account };
	};

	// ---- The account's connections

	const grantsOf = (accountId) =>
		fs
			.readdirSync(grantsDir)
			.filter((name) => name.endsWith('.json'))
			.map((name) => readJson(path.join(grantsDir, name)))
			.filter((grant) => grant && grant.accountId === accountId);

	const connections = async (req, body) => {
		const accountId = await accounts.identify(req);
		if (req.method === 'POST' && typeof body.revoke === 'string') {
			const grant = readGrant(body.revoke);
			if (grant && grant.accountId === accountId) {
				removeGrant(grant.id);
				log('application disconnected', JSON.stringify(grant.clientName));
			}
		}
		return {
			connections: grantsOf(accountId)
				.filter((grant) => (grant.refresh?.expiresAt ?? 0) > Date.now())
				.map((grant) => ({
					id: grant.id,
					name: grant.clientName,
					createdAt: grant.createdAt,
					lastUsedAt: grant.lastUsedAt ?? grant.createdAt,
				}))
				.sort((a, b) => b.lastUsedAt - a.lastUsedAt),
		};
	};

	// ---- Cleaning up

	const prune = () => {
		const now = Date.now();
		for (const [key, entry] of codes) if (entry.expiresAt < now) codes.delete(key);
		for (const [key, entry] of requests) {
			if (entry.expiresAt < now) requests.delete(key);
		}
		for (const [key, times] of registrations) {
			if (times.every((time) => now - time > 60 * 60 * 1000)) {
				registrations.delete(key);
			}
		}
		const used = new Set();
		for (const name of fs.readdirSync(grantsDir)) {
			const grant = readJson(path.join(grantsDir, name));
			if (!grant) continue;
			if ((grant.refresh?.expiresAt ?? 0) < now) {
				fs.rmSync(path.join(grantsDir, name), { force: true });
			} else {
				used.add(grant.clientId);
			}
		}
		for (const name of fs.readdirSync(clientsDir)) {
			const client = readJson(path.join(clientsDir, name));
			if (!client) continue;
			const last = client.authorizedAt ?? client.createdAt;
			if (!used.has(client.client_id) && now - last > CLIENT_UNUSED_MS) {
				fs.rmSync(path.join(clientsDir, name), { force: true });
			}
		}
	};
	setInterval(prune, 60 * 60 * 1000).unref();

	// ---- Routes

	const WELL_KNOWN =
		/^\/\.well-known\/(oauth-protected-resource|oauth-authorization-server|openid-configuration)(\/.*)?$/;

	const handles = (url) =>
		WELL_KNOWN.test(url) ||
		(url.startsWith('/oauth/') && url !== '/oauth/connections');
	const handlesAccount = (url) => url === '/oauth/connections';

	const fail = (res, error, options) => {
		if (error instanceof HttpError) {
			reply(
				res,
				error.status,
				{
					error: error.code,
					...(error.description
						? { error_description: error.description }
						: {}),
				},
				{},
				options,
			);
			return;
		}
		// Errors from the accounts (signed out...) carry a status too.
		if (Number.isInteger(error?.status) && typeof error.code === 'string') {
			reply(res, error.status, { error: error.code }, {}, options);
			return;
		}
		log('oauth request failed', error);
		reply(res, 500, { error: 'server_error' }, {}, options);
	};

	const handle = async (req, res, url) => {
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST',
				'Access-Control-Allow-Headers':
					'Authorization, Content-Type, MCP-Protocol-Version',
				'Access-Control-Max-Age': '86400',
			});
			res.end();
			return;
		}
		const wellKnown = WELL_KNOWN.exec(url);
		if (wellKnown) {
			req.resume();
			reply(
				res,
				200,
				wellKnown[1] === 'oauth-protected-resource'
					? protectedResource(req)
					: authorizationServer(req),
			);
			return;
		}
		try {
			if (url === '/oauth/register' && req.method === 'POST') {
				reply(res, 201, register(req, await readBody(req)));
				return;
			}
			if (url === '/oauth/authorize' && req.method === 'GET') {
				req.resume();
				startAuthorization(
					req,
					res,
					new URL(req.url, 'http://localhost').searchParams,
				);
				return;
			}
			if (url === '/oauth/authorize' && req.method === 'POST') {
				await finishAuthorization(req, res, await readBody(req));
				return;
			}
			if (url === '/oauth/token' && req.method === 'POST') {
				reply(res, 200, token(req, await readBody(req)), { Pragma: 'no-cache' });
				return;
			}
			req.resume();
			reply(res, 404, { error: 'not_found' });
		} catch (error) {
			fail(res, error);
		}
	};

	const handleAccount = async (req, res) => {
		const options = { anyOrigin: false };
		try {
			if (req.method !== 'GET' && req.method !== 'POST') {
				req.resume();
				reply(res, 405, { error: 'method_not_allowed' }, {}, options);
				return;
			}
			const body = req.method === 'POST' ? await readBody(req) : {};
			if (req.method !== 'POST') req.resume();
			reply(res, 200, await connections(req, body), {}, options);
		} catch (error) {
			fail(res, error, options);
		}
	};

	return {
		handles,
		handle,
		handlesAccount,
		handleAccount,
		authenticate,
		challenge,
		resourceUrl,
	};
};

module.exports = { createOAuth };
