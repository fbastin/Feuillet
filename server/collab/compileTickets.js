// server/collab/compileTickets.js
// Tickets to compile on the TeX Live server (server/texlive), which compiles
// only for an account, as Overleaf does: the signed-in account, or the one
// that owns a project whoever compiles opened by its link (a guest given a
// read-only link sees its PDF). Without a ticket, the TeX Live server
// refuses the connection: whoever only knows its address cannot use it.
//
//   POST /compile/ticket               (token) -> {ticket, expiresAt}
//   POST /compile/ticket {project}     -> {ticket, expiresAt}: by a link to
//                                      a project an account owns
//   GET  /compile/ticket               -> {enabled}
//
// A ticket is "<payload>.<signature>" in base64url: the payload, JSON
// {s, e}, says whom it is for (an account's id, or "link:" and the owner's
// for a link) and when it ends (in seconds); the signature is Ed25519's. The
// TeX Live server checks it with the public key alone, so that neither it
// nor the documents it compiles can make one. A connection ends with its
// ticket, which the editor replaces before (GenericTypesetterService).
//
// Environment (read by server.js):
//   COMPILE_TICKET_KEY  the private key, PKCS #8 DER in base64, which
//                       deploy/install.sh makes; unset, there are no
//                       tickets, and a TeX Live server without the public
//                       key (COMPILE_TICKET_PUBLIC_KEY) asks for none

const crypto = require('node:crypto');

const TICKET_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 4096;
const WINDOW_MS = 15 * 60 * 1000;
// Tickets one address may take by links in WINDOW_MS; accounts are not
// counted, a device asking for one per connection.
const MAX_LINK_TICKETS_PER_IP = 120;

class TicketError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

/** The private key of COMPILE_TICKET_KEY, or null when it is unset. */
const readTicketKey = (value) => {
	const text = String(value ?? '').trim();
	if (!text) return null;
	const key = crypto.createPrivateKey({
		key: Buffer.from(text, 'base64'),
		format: 'der',
		type: 'pkcs8',
	});
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new Error('COMPILE_TICKET_KEY is not an Ed25519 private key');
	}
	return key;
};

/** A ticket for `subject`, signed with `key`, ending in `seconds`. */
const signTicket = (key, subject, seconds = TICKET_SECONDS, now = Date.now()) => {
	const expiresAt = Math.floor(now / 1000) + seconds;
	const payload = base64url(JSON.stringify({ s: subject, e: expiresAt }));
	const signature = base64url(crypto.sign(null, Buffer.from(payload), key));
	return { ticket: `${payload}.${signature}`, expiresAt: expiresAt * 1000 };
};

const readBody = (req) =>
	new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new TicketError(413, 'too_large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			if (size === 0) {
				resolve({});
				return;
			}
			try {
				const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				resolve(body && typeof body === 'object' ? body : {});
			} catch {
				reject(new TicketError(400, 'invalid_json'));
			}
		});
		req.on('error', reject);
	});

const createCompileTickets = ({ key, accounts, shares, log = () => {} }) => {
	const attempts = new Map();

	const limit = (ip) => {
		const now = Date.now();
		const recent = (attempts.get(ip) ?? []).filter((at) => at > now - WINDOW_MS);
		if (recent.length >= MAX_LINK_TICKETS_PER_IP) {
			throw new TicketError(429, 'too_many_attempts');
		}
		recent.push(now);
		attempts.set(ip, recent);
		if (attempts.size > 10000) {
			for (const [address, times] of attempts) {
				if (times.every((at) => at <= now - WINDOW_MS)) attempts.delete(address);
			}
		}
	};

	/** A ticket for an account (its id), for the assistants that compile. */
	const forAccount = (account) => (key ? signTicket(key, account).ticket : null);

	const issue = async (req, body) => {
		if (req.headers.authorization) {
			return signTicket(key, await accounts.identify(req));
		}
		limit(accounts.clientAddress(req));
		const owner = shares.ownerOf(body.project);
		if (!owner || !accounts.usernameOf(owner)) {
			throw new TicketError(403, 'account_required');
		}
		return signTicket(key, `link:${owner}`);
	};

	const handles = (path) => path === '/compile/ticket';

	const handle = async (req, res) => {
		const reply = (status, body) => {
			res.writeHead(status, {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			});
			res.end(JSON.stringify(body));
		};
		try {
			if (req.method === 'GET') {
				req.resume();
				reply(200, { enabled: Boolean(key) });
				return;
			}
			if (req.method !== 'POST') {
				req.resume();
				res.setHeader('Allow', 'GET, POST, OPTIONS');
				reply(405, { error: 'method_not_allowed' });
				return;
			}
			if (!key) {
				req.resume();
				reply(404, { error: 'tickets_disabled' });
				return;
			}
			reply(200, await issue(req, await readBody(req)));
		} catch (error) {
			req.resume();
			const status = Number.isInteger(error?.status) ? error.status : 500;
			if (status === 500) log('compile ticket failed', error);
			reply(status, {
				error: typeof error?.code === 'string' ? error.code : 'server_error',
			});
		}
	};

	return { enabled: Boolean(key), handles, handle, forAccount };
};

module.exports = { createCompileTickets, readTicketKey, signTicket, TICKET_SECONDS };
