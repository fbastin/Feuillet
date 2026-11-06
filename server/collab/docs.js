// server/collab/docs.js
// « Ouvrir dans Feuillet », as Overleaf's "Open in Overleaf": a page links
// to, or posts a form to, /docs with the fields of
// https://www.overleaf.com/docs, and the person makes a project of it.
//
//   GET|POST /docs?snip_uri=…  -> 303 to the app's /#open:<id>
//   GET /docs/<id>             -> {sources, names, engine, mainDocument,
//                                  visualEditor}
//
// The fields are Overleaf's: snip (LaTeX), encoded_snip (URL-encoded LaTeX)
// and snip_uri (a file's address, a .zip, or a data: URL), each repeatable,
// also with []; snip_name, the files' names in the same order; engine
// (latex_dvipdf, pdflatex, xelatex, lualatex); main_document; visual_editor
// (or rich_text) = true.
//
// Nothing is created here: the page asks the person first, then downloads
// the files through /fetch with their account. The request is only kept in
// memory, for 30 minutes, so that signing in on the way does not lose it.

const crypto = require('node:crypto');

const KEEP_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_KEPT_BYTES = 64 * 1024 * 1024;
const MAX_KEPT = 1000;
const MAX_SOURCES = 32;
const MAX_URL_LENGTH = 4096;
const MAX_NAME_LENGTH = 255;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ADDRESS = 120;
const ENGINES = new Set(['latex_dvipdf', 'pdflatex', 'xelatex', 'lualatex']);
const ID = /^[A-Za-z0-9_-]{32}$/;
const ROUTE = /^\/docs(?:\/([^/]*))?\/?$/;

class OpenLinkError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

// What a person who followed a broken link reads, in both languages of the
// interface's first users.
const MESSAGES = {
	empty:
		'Ce lien ne contient ni code LaTeX ni fichier à ouvrir.\nThis link holds no LaTeX code or file to open.',
	bad_uri:
		'Ce lien donne une adresse de fichier qui n’est ni http, ni https, ni data:.\nThis link gives a file address that is not http, https or data:.',
	too_many_files: `Ce lien donne plus de ${MAX_SOURCES} fichiers.\nThis link gives more than ${MAX_SOURCES} files.`,
	too_large:
		'Ce lien est trop volumineux pour être ouvert.\nThis link is too large to open.',
	unsupported_type:
		'Ce formulaire doit être envoyé en application/x-www-form-urlencoded.\nThis form must be sent as application/x-www-form-urlencoded.',
	too_many:
		'Trop de liens ont été ouverts depuis cette adresse. Réessayez dans quelques minutes.\nToo many links were opened from this address. Try again in a few minutes.',
	busy: 'Trop de liens sont en cours d’ouverture. Réessayez dans quelques minutes.\nToo many links are being opened. Try again in a few minutes.',
	interrupted: 'L’envoi a été interrompu.\nThe request was interrupted.',
};

const send = (res, status, type, body, headers = {}) => {
	res.writeHead(status, {
		'Content-Type': type,
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		...headers,
	});
	res.end(body);
};

const sendError = (res, error) =>
	send(
		res,
		error.status,
		'text/plain; charset=utf-8',
		`${MESSAGES[error.code] ?? error.code}\n`,
	);

/** A text field as the person wrote it, with Unix line ends. */
const unixText = (value) => value.replace(/\r\n?/g, '\n');

/**
 * An encoded_snip once decoded. A form sends it encoded twice (the page's
 * encodeURIComponent, then the form's); a link sometimes only once, and
 * LaTeX's % then cannot always be decoded again: it is kept as it came.
 */
const decodedSnip = (value) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const validUri = (value) => {
	const uri = value.trim();
	if (/^data:/i.test(uri)) return uri;
	if (uri.length > MAX_URL_LENGTH) throw new OpenLinkError(400, 'bad_uri');
	let parsed;
	try {
		parsed = new URL(uri);
	} catch {
		throw new OpenLinkError(400, 'bad_uri');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new OpenLinkError(400, 'bad_uri');
	}
	return parsed.href;
};

const field = (key) => key.replace(/\[\]$/, '');

/** The request a link or form makes, as the page reads it. */
const parseOpenRequest = (params) => {
	const sources = [];
	const names = [];
	let engine;
	let mainDocument;
	let visualEditor = false;
	for (const [key, value] of params) {
		switch (field(key)) {
			case 'snip':
				sources.push({ text: unixText(value) });
				break;
			case 'encoded_snip':
				sources.push({ text: unixText(decodedSnip(value)) });
				break;
			case 'snip_uri':
				if (value.trim()) sources.push({ uri: validUri(value) });
				break;
			case 'snip_name':
				names.push(value.trim().slice(0, MAX_NAME_LENGTH));
				break;
			case 'engine':
				if (ENGINES.has(value)) engine = value;
				break;
			case 'main_document':
				if (value.trim()) mainDocument = value.trim().slice(0, MAX_NAME_LENGTH);
				break;
			case 'visual_editor':
			case 'rich_text':
				if (value === 'true') visualEditor = true;
				break;
			default:
				break;
		}
		if (sources.length > MAX_SOURCES) {
			throw new OpenLinkError(400, 'too_many_files');
		}
	}
	if (sources.length === 0) throw new OpenLinkError(400, 'empty');
	return {
		sources,
		names: names.slice(0, sources.length),
		...(engine ? { engine } : {}),
		...(mainDocument ? { mainDocument } : {}),
		...(visualEditor ? { visualEditor } : {}),
	};
};

const sizeOf = (request) =>
	request.sources.reduce(
		(total, source) => total + (source.text ?? source.uri).length,
		0,
	) + request.names.reduce((total, name) => total + name.length, 0);

const createOpenLinks = ({ appUrl = '', isAllowedOrigin = () => false }) => {
	const appBase = String(appUrl).replace(/\/+$/, '');
	const kept = new Map();
	const recent = new Map();
	let keptBytes = 0;

	const forget = () => {
		const now = Date.now();
		for (const [id, entry] of kept) {
			if (entry.expires > now) continue;
			kept.delete(id);
			keptBytes -= entry.size;
		}
		for (const [address, times] of recent) {
			if (times.every((time) => now - time >= WINDOW_MS)) {
				recent.delete(address);
			}
		}
	};
	setInterval(forget, 60 * 1000).unref();

	// Apache appends the address it received the request from.
	const clientAddress = (req) =>
		String(req.headers['x-forwarded-for'] ?? '')
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
			.pop() ?? req.socket.remoteAddress;

	const limit = (address) => {
		const now = Date.now();
		const times = (recent.get(address) ?? []).filter(
			(time) => now - time < WINDOW_MS,
		);
		if (times.length >= MAX_PER_ADDRESS) {
			throw new OpenLinkError(429, 'too_many');
		}
		times.push(now);
		recent.set(address, times);
	};

	const readForm = (req) =>
		new Promise((resolve, reject) => {
			const type = String(req.headers['content-type'] ?? '')
				.split(';')[0]
				.trim()
				.toLowerCase();
			if (type !== 'application/x-www-form-urlencoded') {
				req.resume();
				reject(new OpenLinkError(415, 'unsupported_type'));
				return;
			}
			const chunks = [];
			let size = 0;
			let failed = false;
			req.on('data', (chunk) => {
				if (failed) return;
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					failed = true;
					reject(new OpenLinkError(413, 'too_large'));
					req.resume();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				if (!failed) {
					resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
				}
			});
			req.on('error', () => {
				if (!failed) reject(new OpenLinkError(400, 'interrupted'));
			});
		});

	const keep = (request) => {
		forget();
		const size = sizeOf(request);
		if (kept.size >= MAX_KEPT || keptBytes + size > MAX_KEPT_BYTES) {
			throw new OpenLinkError(503, 'busy');
		}
		const id = crypto.randomBytes(24).toString('base64url');
		kept.set(id, { request, size, expires: Date.now() + KEEP_MS });
		keptBytes += size;
		return id;
	};

	const open = async (req, res) => {
		try {
			limit(clientAddress(req));
			const params =
				req.method === 'POST'
					? await readForm(req)
					: new URL(req.url, 'http://localhost').searchParams;
			if (req.method === 'POST') {
				// A form may also carry fields in its action's address.
				for (const [key, value] of new URL(req.url, 'http://localhost')
					.searchParams) {
					params.append(key, value);
				}
			}
			const id = keep(parseOpenRequest(params));
			res.writeHead(303, {
				Location: `${appBase}/#open:${id}`,
				'Cache-Control': 'no-store',
			});
			res.end();
		} catch (error) {
			if (error instanceof OpenLinkError) {
				sendError(res, error);
			} else {
				send(res, 500, 'text/plain; charset=utf-8', 'Server error\n');
			}
		}
	};

	const read = (req, res, id) => {
		const origin = req.headers.origin;
		if (origin && isAllowedOrigin(origin)) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
		}
		forget();
		const entry = ID.test(id) ? kept.get(id) : undefined;
		if (!entry) {
			send(
				res,
				404,
				'application/json',
				JSON.stringify({ error: 'expired' }),
			);
			return;
		}
		send(res, 200, 'application/json', JSON.stringify(entry.request));
	};

	return {
		handles: (url) => ROUTE.test(url),
		handle: (req, res, url) => {
			const id = url.match(ROUTE)?.[1];
			if (id) {
				if (req.method === 'GET' || req.method === 'HEAD') {
					read(req, res, id);
				} else if (req.method === 'OPTIONS') {
					const origin = req.headers.origin;
					res.writeHead(204, {
						...(origin && isAllowedOrigin(origin)
							? {
									'Access-Control-Allow-Origin': origin,
									'Access-Control-Allow-Methods': 'GET',
									Vary: 'Origin',
								}
							: {}),
					});
					res.end();
				} else {
					req.resume();
					send(res, 405, 'text/plain', 'Method not allowed\n', {
						Allow: 'GET',
					});
				}
				return;
			}
			if (req.method === 'GET' || req.method === 'POST') {
				void open(req, res);
				return;
			}
			req.resume();
			send(res, 405, 'text/plain', 'Method not allowed\n', {
				Allow: 'GET, POST',
			});
		},
	};
};

module.exports = { createOpenLinks, parseOpenRequest };
