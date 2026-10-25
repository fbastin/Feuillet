#!/usr/bin/env node
// server/collab/server.js
// Feuillet collaboration server: relays Yjs documents between editors over
// WebSocket (y-websocket protocol) and persists them, so collaborators do not
// need to be online at the same time.
//
// Environment:
//   HOST, PORT          listen address (default 0.0.0.0:1234)
//   ALLOWED_ORIGINS     comma-separated browser origins allowed to connect;
//                       empty allows any origin (local development only)
//   YPERSISTENCE        LevelDB directory for document storage (read by
//                       y-websocket); unset keeps documents in memory only
//   MAX_MESSAGE_BYTES   largest accepted WebSocket message (default 64 MiB)

const http = require('node:http');
const { WebSocketServer } = require('ws');
const { docs, setupWSConnection } = require('y-websocket/bin/utils');

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

// Feuillet rooms are `<projectId>-<collection>`, e.g. `abc123-yjs_metadata`.
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

const log = (...parts) =>
	console.log(new Date().toISOString(), '[collab]', ...parts);

const reject = (socket, status, reason) => {
	socket.write(
		`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
	);
	socket.destroy();
};

const server = http.createServer((req, res) => {
	if (req.url === '/health') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ status: 'ok', documents: docs.size }));
		return;
	}
	res.writeHead(404, { 'Content-Type': 'text/plain' });
	res.end('Feuillet collaboration server\n');
});

const wss = new WebSocketServer({ noServer: true, maxPayload });

server.on('upgrade', (req, socket, head) => {
	const origin = req.headers.origin || '';
	if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
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
			? `persisting to ${process.env.YPERSISTENCE}`
			: 'in-memory only',
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
