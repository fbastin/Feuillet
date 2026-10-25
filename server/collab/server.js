#!/usr/bin/env node
// server/collab/server.js
// Feuillet collaboration server:
//  - relays Yjs documents between editors over WebSocket (y-websocket
//    protocol) and persists them, so collaborators do not need to be online
//    at the same time;
//  - stores project file contents by SHA-256 (PUT/GET /files/<project>/<hash>),
//    so every collaborator receives the files listed in the shared manifest.
//
// Environment:
//   HOST, PORT          listen address (default 0.0.0.0:1234)
//   ALLOWED_ORIGINS     comma-separated browser origins allowed to connect;
//                       empty allows any origin (local development only)
//   YPERSISTENCE        LevelDB directory for document storage (read by
//                       y-websocket); unset keeps documents in memory only
//   FILES_DIR           directory for file contents (default ./files)
//   MAX_MESSAGE_BYTES   largest accepted WebSocket message (default 64 MiB)
//   MAX_FILE_BYTES      largest accepted file (default 100 MiB)

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer } = require('ws');

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

// LevelDB does not create parent directories, and y-websocket opens it as
// soon as its module loads.
fs.mkdirSync(filesDir, { recursive: true });
if (process.env.YPERSISTENCE) {
	fs.mkdirSync(process.env.YPERSISTENCE, { recursive: true });
}
const { docs, setupWSConnection } = require('y-websocket/bin/utils');

// Feuillet rooms are `<projectId>-<collection>`, e.g. `abc123-yjs_metadata`.
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const FILE_ROUTE = /^\/files\/([A-Za-z0-9_-]{1,100})\/([0-9a-f]{64})$/;

const log = (...parts) =>
	console.log(new Date().toISOString(), '[collab]', ...parts);

const isAllowedOrigin = (origin) =>
	allowedOrigins.length === 0 || allowedOrigins.includes(origin);

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
		const [, projectId, hash] = fileRoute;
		const projectDir = path.join(filesDir, projectId);
		const filePath = path.join(projectDir, hash);
		if (req.method === 'GET' || req.method === 'HEAD') {
			serveFile(req, res, filePath);
			return;
		}
		if (req.method === 'PUT') {
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

	wss.handleUpgrade(req, socket, head, (conn) => {
		setupWSConnection(conn, req, { docName: room });
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
		`files in ${filesDir}`,
	);
});

const shutdown = (signal) => {
	log(`${signal} received, closing`);
	for (const client of wss.clients) client.close(1001, 'Server restarting');
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
