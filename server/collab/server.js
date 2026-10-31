#!/usr/bin/env node
// server/collab/server.js
// Feuillet collaboration server:
//  - relays Yjs documents between editors over WebSocket (y-websocket
//    protocol) and persists them, so collaborators do not need to be online
//    at the same time;
//  - stores project file contents by SHA-256 (PUT/GET /files/<project>/<hash>),
//    so every collaborator receives the files listed in the shared manifest;
//  - keeps accounts and their project lists (/account/..., accounts.js), so
//    that signing in on another device shows the same projects;
//  - gives projects read-only links (/share/view, shares.js): a connection
//    through one receives the project, and its changes are dropped;
//  - lets a project's owner replace its editing link (/share/edit,
//    shares.js), which cuts off whoever kept the old one, and invite other
//    accounts, who follow its links as they change (/share/members);
//  - lets reviewers, through their own link, change documents only by
//    comments and tracked changes (review.js), as on Overleaf;
//  - copies projects (/share/copy, copy.js) and tells accounts who owns
//    the projects they list, as Overleaf's project list does;
//  - saves versions of each project a short while after it changes, with who
//    changed it (/history/..., history.js), as on Overleaf;
//  - signs people in with GitHub for GitHub sync (/github/..., github.js),
//    handing the token to their browser without keeping it;
//  - downloads files from the web for signed-in accounts (/fetch,
//    fetch.js), as Overleaf's "From external URL";
//  - lets assistants such as Claude work on an account's projects once it
//    agrees (/mcp, mcp.js; /oauth/..., oauth.js).
//
// Environment:
//   HOST, PORT          listen address (default 0.0.0.0:1234)
//   ALLOWED_ORIGINS     comma-separated browser origins allowed to connect;
//                       empty allows any origin (local development only)
//   YPERSISTENCE        LevelDB directory for document storage (read by
//                       y-websocket); unset keeps documents in memory only
//   FILES_DIR           directory for file contents (default ./files)
//   ACCOUNTS_DIR        directory for accounts (default ./accounts)
//   SHARES_DIR          directory for project links (default ./shares)
//   HISTORY_DIR         directory for project versions (default ./history)
//   HISTORY_IDLE_MS     quiet time before a version is saved (default 30 s)
//   HISTORY_MAX_VERSIONS  unlabelled versions kept per project (default 1000)
//   PUBLIC_URL          this server's public address, for GitHub to send
//                       people back to (e.g. https://example.org/collab)
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
//                       the GitHub OAuth App behind "Sign in with GitHub";
//                       unset turns it off
//   GITHUB_OAUTH_URL    GitHub's address for signing in (tests only)
//   MCP_DIR             directory for the applications accounts let work on
//                       their projects (default ./mcp)
//   MCP_REDIRECT_URIS   comma-separated addresses, besides Claude's and
//                       programs on the same computer, that applications
//                       may send people back to after they agree
//   TEXLIVE_URL         the TeX Live server, for assistants to compile
//                       (e.g. ws://texlive:7045); unset turns that off
//   TEXLIVE_ORIGIN      the Origin to show it (default: the first of
//                       ALLOWED_ORIGINS)
//   MAX_MESSAGE_BYTES   largest accepted WebSocket message (default 64 MiB)
//   MAX_FILE_BYTES      largest accepted file (default 100 MiB)

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const { createAccounts } = require('./accounts');
const { createCompiler } = require('./compile');
const { createProjectCopier } = require('./copy');
const { createUrlFetcher } = require('./fetch');
const { createGitHub } = require('./github');
const { createHistory } = require('./history');
const { createMcp } = require('./mcp');
const { createOAuth } = require('./oauth');
const { createProjectFiles } = require('./projectFiles');
const { createReviewGuard } = require('./review');
const { createShares } = require('./shares');

const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '1234', 10);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
	.split(',')
	.map((origin) => origin.trim())
	.filter(Boolean);
const maxPayload = Number.parseInt(
	process.env.MAX_MESSAGE_BYTES || String(64 * 1024 * 1024),
	10,
);
const maxFileBytes = Number.parseInt(
	process.env.MAX_FILE_BYTES || String(100 * 1024 * 1024),
	10,
);
const filesDir = path.resolve(process.env.FILES_DIR || 'files');
const accountsDir = path.resolve(process.env.ACCOUNTS_DIR || 'accounts');
const sharesDir = path.resolve(process.env.SHARES_DIR || 'shares');
const historyDir = path.resolve(process.env.HISTORY_DIR || 'history');
const mcpDir = path.resolve(process.env.MCP_DIR || 'mcp');

// LevelDB does not create parent directories, and y-websocket opens it as
// soon as its module loads.
fs.mkdirSync(filesDir, { recursive: true });
if (process.env.YPERSISTENCE) {
	fs.mkdirSync(process.env.YPERSISTENCE, { recursive: true });
}
const {
	docs,
	getPersistence,
	getYDoc,
	setupWSConnection,
} = require('y-websocket/bin/utils');

// Feuillet rooms are `<projectId>-<collection>`, e.g. `abc123-yjs_metadata`,
// where the project id is a UUID, an older id without dashes, or a read-only
// link's view id.
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const PROJECT_ROOM =
	/^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[A-Za-z0-9_]+)-(.+)$/i;
const FILE_ROUTE = /^\/files\/([A-Za-z0-9_-]{1,100})\/([0-9a-f]{64})$/;
// A document's room; `yjs_metadata` holds the project's settings instead.
const DOCUMENT_ROOM = /^yjs_(?!metadata$).+$/;

const log = (...parts) =>
	console.log(new Date().toISOString(), '[collab]', ...parts);

const isAllowedOrigin = (origin) =>
	allowedOrigins.length === 0 || allowedOrigins.includes(origin);

const accounts = createAccounts({ dir: accountsDir, log });

// Connections by the link they were opened through, closed when it is
// replaced. Close codes 4400-4499 tell clients not to reconnect.
const connections = new Map();
const shares = createShares({
	dir: sharesDir,
	log,
	accounts,
	onRevoke: (id) => {
		for (const conn of connections.get(id) ?? []) {
			conn.close(4403, 'Link replaced');
		}
	},
	copyProject: createProjectCopier({
		docs,
		persistence: getPersistence(),
		getYDoc,
		filesDir,
	}),
});
accounts.setProjectDescriber(shares.describe);

const github = createGitHub({
	clientId: process.env.GITHUB_CLIENT_ID,
	clientSecret: process.env.GITHUB_CLIENT_SECRET,
	publicUrl: process.env.PUBLIC_URL,
	oauthUrl: process.env.GITHUB_OAUTH_URL || undefined,
	isAllowedOrigin,
	log,
});

const history = createHistory({
	dir: historyDir,
	filesDir,
	docs,
	persistence: getPersistence(),
	log,
	idleMs: Number(process.env.HISTORY_IDLE_MS) || undefined,
	maxVersions: Number(process.env.HISTORY_MAX_VERSIONS) || undefined,
});

const urlFetcher = createUrlFetcher({ accounts, maxBytes: maxFileBytes, log });

const oauth = createOAuth({
	dir: mcpDir,
	publicUrl: process.env.PUBLIC_URL,
	accounts,
	log,
	redirectUris: (process.env.MCP_REDIRECT_URIS || '')
		.split(',')
		.map((uri) => uri.trim())
		.filter(Boolean),
});
const mcp = createMcp({
	oauth,
	shares,
	files: createProjectFiles({
		docs,
		persistence: getPersistence(),
		getYDoc,
		filesDir,
	}),
	history,
	compiler: createCompiler({
		url: process.env.TEXLIVE_URL,
		origin: process.env.TEXLIVE_ORIGIN || allowedOrigins[0],
	}),
	log,
});

const reviewGuard = createReviewGuard({
	docs,
	persistence: getPersistence(),
	log,
});

// A read-only connection may ask for the document (the first step of a
// sync) and show its presence; whatever else it sends is dropped, so that it
// cannot change the project.
const VIEWER_MESSAGES = [
	(bytes) => bytes[0] === 0 && bytes[1] === 0,
	(bytes) => bytes[0] === 1,
];
const makeReadOnly = (conn) => {
	const on = conn.on.bind(conn);
	conn.on = (event, listener) =>
		on(
			event,
			event === 'message'
				? (data, ...rest) => {
						const bytes =
							data instanceof Uint8Array ? data : new Uint8Array(data);
						if (VIEWER_MESSAGES.some((allowed) => allowed(bytes))) {
							listener(data, ...rest);
						}
					}
				: listener,
		);
};

const reject = (socket, status, reason) => {
	socket.write(
		`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
	);
	socket.destroy();
};

const send = (res, status, body = '') => {
	res.writeHead(status, { 'Content-Type': 'text/plain' });
	res.end(body);
};

const serveFile = (req, res, filePath) => {
	fs.stat(filePath, (error, stats) => {
		if (error || !stats.isFile()) {
			send(res, 404, 'Not found\n');
			return;
		}
		res.writeHead(200, {
			'Content-Type': 'application/octet-stream',
			'Content-Length': stats.size,
			// Content-addressed: a hash always names the same bytes.
			'Cache-Control': 'private, max-age=31536000, immutable',
		});
		if (req.method === 'HEAD') {
			res.end();
			return;
		}
		fs.createReadStream(filePath).pipe(res);
	});
};

const storeFile = (req, res, projectDir, filePath, expectedHash) => {
	const declaredLength = Number(req.headers['content-length'] || 0);
	if (declaredLength > maxFileBytes) {
		send(res, 413, 'File too large\n');
		req.resume();
		return;
	}
	if (fs.existsSync(filePath)) {
		send(res, 200, 'Already stored\n');
		req.resume();
		return;
	}

	fs.mkdirSync(projectDir, { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
	const output = fs.createWriteStream(tempPath);
	const hash = crypto.createHash('sha256');
	let received = 0;
	let failed = false;

	const fail = (status, message) => {
		if (failed) return;
		failed = true;
		output.destroy();
		fs.rm(tempPath, { force: true }, () => {});
		send(res, status, message);
		req.resume();
	};

	req.on('data', (chunk) => {
		received += chunk.length;
		if (received > maxFileBytes) {
			fail(413, 'File too large\n');
			return;
		}
		hash.update(chunk);
		if (!output.write(chunk)) {
			req.pause();
			output.once('drain', () => req.resume());
		}
	});
	req.on('error', () => fail(400, 'Upload interrupted\n'));
	req.on('end', () => {
		if (failed) return;
		output.end(() => {
			if (hash.digest('hex') !== expectedHash) {
				fail(400, 'Content does not match its hash\n');
				return;
			}
			fs.rename(tempPath, filePath, (error) => {
				if (error) {
					fail(500, 'Could not store file\n');
					return;
				}
				send(res, 201, 'Stored\n');
			});
		});
	});
};

const server = http.createServer((req, res) => {
	const url = (req.url || '').split('?')[0];

	if (url === '/health') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ status: 'ok', documents: docs.size }));
		return;
	}

	// Applications call these with their own tokens, from anywhere.
	if (mcp.handles(url)) {
		void mcp.handle(req, res);
		return;
	}
	if (oauth.handles(url)) {
		void oauth.handle(req, res, url);
		return;
	}

	const api = accounts.handles(url)
		? accounts
		: shares.handles(url)
			? shares
			: urlFetcher.handles(url)
				? urlFetcher
				: oauth.handlesAccount(url)
					? { handle: (request, response) => oauth.handleAccount(request, response) }
					: null;
	if (api) {
		const origin = req.headers.origin;
		if (origin && !isAllowedOrigin(origin)) {
			send(res, 403, 'Forbidden\n');
			req.resume();
			return;
		}
		if (origin) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
		}
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Methods': 'GET, POST, DELETE',
				'Access-Control-Allow-Headers': 'Authorization, Content-Type',
				'Access-Control-Max-Age': '86400',
			});
			res.end();
			return;
		}
		api.handle(req, res, url);
		return;
	}

	if (github.handles(url)) {
		const origin = req.headers.origin;
		if (origin && isAllowedOrigin(origin)) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
		}
		const params = new URL(req.url, 'http://localhost').searchParams;
		github.handle(req, res, url, params);
		return;
	}

	const historyRoute = history.route(url);
	if (historyRoute) {
		const origin = req.headers.origin;
		// Browsers always send Origin when changing labels.
		const reads = req.method === 'GET' || req.method === 'HEAD';
		if ((origin || !reads) && !isAllowedOrigin(origin || '')) {
			send(res, 403, 'Forbidden\n');
			req.resume();
			return;
		}
		if (origin) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
		}
		const found = shares.lookup(historyRoute.id);
		if (!found || found.access === 'replaced') {
			req.resume();
			send(res, found ? 403 : 404, found ? 'Link replaced\n' : 'Not found\n');
			return;
		}
		void history.handle(req, res, historyRoute, found);
		return;
	}

	const fileRoute = url.match(FILE_ROUTE);
	if (fileRoute) {
		const origin = req.headers.origin;
		// Browsers always send Origin on PUT; same-origin GETs may omit it.
		if ((origin || req.method === 'PUT') && !isAllowedOrigin(origin || '')) {
			send(res, 403, 'Forbidden\n');
			req.resume();
			return;
		}
		// The app and this server share an origin in production; CORS is for
		// development setups where they run on different ports.
		if (origin) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
		}
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Methods': 'GET, HEAD, PUT',
				'Access-Control-Allow-Headers': 'Content-Type',
				'Access-Control-Max-Age': '86400',
			});
			res.end();
			return;
		}
		const [, id, hash] = fileRoute;
		const found = shares.lookup(id);
		if (!found) {
			req.resume();
			send(res, 404, 'Not found\n');
			return;
		}
		if (found.access === 'replaced') {
			req.resume();
			send(res, 403, 'Link replaced\n');
			return;
		}
		// Through a read-only or review link, files are only read.
		const viewing = found.access !== 'edit';
		const projectDir = path.join(filesDir, found.project);
		const filePath = path.join(projectDir, hash);
		if (req.method === 'GET' || req.method === 'HEAD') {
			serveFile(req, res, filePath);
			return;
		}
		if (req.method === 'PUT') {
			if (viewing) {
				req.resume();
				send(res, 403, 'Read-only link\n');
				return;
			}
			storeFile(req, res, projectDir, filePath, hash);
			return;
		}
		res.setHeader('Allow', 'GET, HEAD, PUT, OPTIONS');
		send(res, 405, 'Method not allowed\n');
		return;
	}

	send(res, 404, 'Feuillet collaboration server\n');
});

const wss = new WebSocketServer({ noServer: true, maxPayload });

server.on('upgrade', (req, socket, head) => {
	const origin = req.headers.origin || '';
	if (!isAllowedOrigin(origin)) {
		log('rejected origin', JSON.stringify(origin));
		reject(socket, 403, 'Forbidden');
		return;
	}

	const room = (req.url || '').slice(1).split('?')[0];
	if (!ROOM_PATTERN.test(room)) {
		reject(socket, 400, 'Bad Request');
		return;
	}

	const projectRoom = room.match(PROJECT_ROOM);
	if (!projectRoom) {
		wss.handleUpgrade(req, socket, head, (conn) => {
			setupWSConnection(conn, req, { docName: room });
		});
		return;
	}
	const [, id, collection] = projectRoom;
	const found = shares.lookup(id);

	wss.handleUpgrade(req, socket, head, (conn) => {
		// Closing, rather than refusing the upgrade, tells the client why and
		// stops it from trying again.
		if (!found || found.access === 'replaced') {
			if (found) conn.close(4403, 'Link replaced');
			else conn.close(4404, 'Unknown link');
			return;
		}
		const docName = `${found.project}-${collection}`;
		if (found.access === 'view') makeReadOnly(conn);
		if (found.access === 'review') {
			// Reviewers chat, and change documents only as review.js allows;
			// the project's files and settings they only read.
			if (DOCUMENT_ROOM.test(collection)) reviewGuard.guard(conn, docName);
			else if (collection !== 'chat') makeReadOnly(conn);
		}
		if (!connections.has(id)) connections.set(id, new Set());
		connections.get(id).add(conn);
		conn.on('close', () => {
			connections.get(id)?.delete(conn);
			if (connections.get(id)?.size === 0) connections.delete(id);
		});
		setupWSConnection(conn, req, { docName });
		history.track(found.project, collection, docs.get(docName));
	});
});

server.listen(port, host, () => {
	log(
		`listening on ${host}:${port};`,
		allowedOrigins.length > 0
			? `origins: ${allowedOrigins.join(', ')};`
			: 'any origin;',
		process.env.YPERSISTENCE
			? `documents in ${process.env.YPERSISTENCE};`
			: 'documents in memory only;',
		`files in ${filesDir};`,
		`accounts in ${accountsDir};`,
		`project links in ${sharesDir};`,
		`versions in ${historyDir};`,
		`assistant connections in ${mcpDir};`,
		process.env.TEXLIVE_URL ? 'assistants compile;' : 'assistants do not compile;',
		github.enabled ? 'GitHub sign-in on' : 'GitHub sign-in off',
	);
});

const shutdown = (signal) => {
	log(`${signal} received, closing`);
	for (const client of wss.clients) client.close(1001, 'Server restarting');
	// Changes not saved in a version yet are saved first.
	Promise.all([history.flush(), new Promise((done) => server.close(done))])
		.catch((error) => log('could not save versions', error))
		.then(() => process.exit(0));
	setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
