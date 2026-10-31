// server/collab/fetch.js
// Fetches a file from a URL for a signed-in account, as Overleaf's "From
// external URL": most sites do not let pages download from them (CORS), and
// pages served over https cannot download over http, so the browser asks this
// server instead.
//
//   POST /fetch {url}   (token) -> the file's bytes
//
// Only http and https on their usual ports, and only from public addresses:
// the name is resolved here and the connection made to the address checked,
// so that a URL cannot reach this machine, its containers or a private
// network, even through a redirect or a name that resolves differently the
// second time. The bytes are always sent as a download, never as a page.

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const zlib = require('node:zlib');

const MAX_URL_LENGTH = 4096;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_REDIRECTS = 5;
const IDLE_TIMEOUT_MS = 30 * 1000;
const TOTAL_TIMEOUT_MS = 5 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 100;
const MAX_CONCURRENT = 4;
const PORTS = { 'http:': '80', 'https:': '443' };
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'Feuillet (file import)';

class FetchError extends Error {
	constructor(status, code, extra = {}) {
		super(code);
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}

// This machine, private and shared networks, documentation, multicast and
// reserved ranges, and the IPv6 forms that can carry an IPv4 address (the
// block list checks IPv4-mapped addresses, ::ffff:a.b.c.d, as IPv4).
const blocked = new net.BlockList();
for (const [address, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.88.99.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 3],
]) {
	blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
	['::', 127],
	['64:ff9b::', 96],
	['64:ff9b:1::', 48],
	['100::', 64],
	['2001::', 23],
	['2001:db8::', 32],
	['2002::', 16],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8],
]) {
	blocked.addSubnet(address, prefix, 'ipv6');
}

const isPublicAddress = (address) => {
	const family = net.isIP(address);
	return family !== 0 && !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
};

const parseTarget = (value) => {
	if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
		throw new FetchError(400, 'invalid_url');
	}
	let url;
	try {
		url = new URL(value.trim());
	} catch {
		throw new FetchError(400, 'invalid_url');
	}
	if (!(url.protocol in PORTS) || url.username || url.password) {
		throw new FetchError(400, 'invalid_url');
	}
	if (url.port && url.port !== PORTS[url.protocol]) {
		throw new FetchError(403, 'blocked_port');
	}
	url.hash = '';
	return url;
};

// The address to connect to: every address the name has must be public.
const resolveTarget = async (url) => {
	const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
	let addresses;
	if (net.isIP(host)) {
		addresses = [{ address: host, family: net.isIP(host) }];
	} else {
		try {
			addresses = await dns.promises.lookup(host, { all: true });
		} catch {
			throw new FetchError(502, 'unknown_host');
		}
	}
	if (
		addresses.length === 0 ||
		addresses.some(({ address }) => !isPublicAddress(address))
	) {
		throw new FetchError(403, 'blocked_address');
	}
	return addresses[0];
};

const request = (url, address, signal) =>
	new Promise((resolve, reject) => {
		const client = url.protocol === 'https:' ? https : http;
		const req = client.get(
			url,
			{
				agent: false,
				signal,
				timeout: IDLE_TIMEOUT_MS,
				headers: {
					'User-Agent': USER_AGENT,
					Accept: '*/*',
					'Accept-Encoding': 'gzip, deflate, br',
				},
				// Connects to the address checked above, whatever the name
				// resolves to now.
				lookup: (_hostname, options, callback) =>
					options?.all
						? callback(null, [address])
						: callback(null, address.address, address.family),
			},
			resolve,
		);
		req.on('timeout', () => req.destroy(new FetchError(504, 'timeout')));
		req.on('error', (error) =>
			reject(
				error instanceof FetchError
					? error
					: signal.aborted
						? new FetchError(504, 'timeout')
						: new FetchError(502, 'fetch_failed'),
			),
		);
	});

const open = async (start, signal) => {
	let url = start;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const address = await resolveTarget(url);
		const response = await request(url, address, signal);
		const location = response.headers.location;
		if (!REDIRECTS.has(response.statusCode) || !location) return response;
		response.resume();
		try {
			url = parseTarget(new URL(location, url).href);
		} catch (error) {
			throw error instanceof FetchError && error.code === 'blocked_port'
				? error
				: new FetchError(502, 'invalid_redirect');
		}
	}
	throw new FetchError(502, 'too_many_redirects');
};

const decoderFor = (encoding) => {
	switch (String(encoding ?? '').toLowerCase()) {
		case '':
		case 'identity':
			return null;
		case 'gzip':
		case 'x-gzip':
			return zlib.createGunzip();
		case 'deflate':
			return zlib.createInflate();
		case 'br':
			return zlib.createBrotliDecompress();
		default:
			throw new FetchError(502, 'unsupported_encoding');
	}
};

const createUrlFetcher = ({ accounts, maxBytes, log }) => {
	const recent = new Map();
	let active = 0;

	setInterval(() => {
		const now = Date.now();
		for (const [account, times] of recent) {
			if (times.every((time) => now - time >= WINDOW_MS)) {
				recent.delete(account);
			}
		}
	}, WINDOW_MS).unref();

	const limit = (account) => {
		const now = Date.now();
		const times = (recent.get(account) ?? []).filter(
			(time) => now - time < WINDOW_MS,
		);
		if (times.length >= MAX_PER_ACCOUNT) {
			throw new FetchError(429, 'too_many_fetches');
		}
		times.push(now);
		recent.set(account, times);
	};

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					reject(new FetchError(413, 'too_large'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
				} catch {
					reject(new FetchError(400, 'invalid_json'));
				}
			});
			req.on('error', () => reject(new FetchError(400, 'interrupted')));
		});

	const reply = (res, status, body) => {
		res.writeHead(status, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		});
		res.end(JSON.stringify(body));
	};

	// Sends the response's body, decoded, until it ends or grows too large;
	// resolves once the response is finished either way.
	const forward = (upstream, decoder, res) =>
		new Promise((resolve) => {
			const source = decoder ? upstream.pipe(decoder) : upstream;
			res.writeHead(200, {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': 'attachment',
				'Content-Security-Policy': "default-src 'none'; sandbox",
				'X-Content-Type-Options': 'nosniff',
				'Cache-Control': 'no-store',
			});
			let sent = 0;
			const stop = () => {
				upstream.destroy();
				decoder?.destroy();
				res.destroy();
				resolve();
			};
			source.on('data', (chunk) => {
				sent += chunk.length;
				if (sent > maxBytes) {
					stop();
					return;
				}
				if (!res.write(chunk)) {
					source.pause();
					res.once('drain', () => source.resume());
				}
			});
			source.on('end', () => {
				res.end();
				resolve();
			});
			source.on('error', stop);
			upstream.on('error', stop);
			res.on('close', () => {
				upstream.destroy();
				resolve();
			});
		});

	const handles = (url) => url === '/fetch';

	const handle = async (req, res) => {
		if (req.method !== 'POST') {
			req.resume();
			res.setHeader('Allow', 'POST, OPTIONS');
			reply(res, 405, { error: 'method_not_allowed' });
			return;
		}
		let counted = false;
		const controller = new AbortController();
		const deadline = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
		try {
			const account = await accounts.identify(req);
			limit(account);
			const body = await readBody(req);
			const url = parseTarget(body?.url);
			if (active >= MAX_CONCURRENT) throw new FetchError(503, 'busy');
			active++;
			counted = true;

			const upstream = await open(url, controller.signal);
			if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
				upstream.resume();
				throw new FetchError(502, 'upstream_status', {
					status: upstream.statusCode,
				});
			}
			let decoder;
			try {
				if (Number(upstream.headers['content-length']) > maxBytes) {
					throw new FetchError(413, 'too_large');
				}
				decoder = decoderFor(upstream.headers['content-encoding']);
			} catch (error) {
				upstream.destroy();
				throw error;
			}
			await forward(upstream, decoder, res);
		} catch (error) {
			req.resume();
			if (res.headersSent) {
				res.destroy();
			} else if (error instanceof FetchError || error?.status) {
				reply(res, error.status, { error: error.code, ...error.extra });
			} else {
				log('fetch failed', error);
				reply(res, 502, { error: 'fetch_failed' });
			}
		} finally {
			clearTimeout(deadline);
			if (counted) active--;
		}
	};

	return { handles, handle };
};

module.exports = { createUrlFetcher, isPublicAddress, parseTarget };
