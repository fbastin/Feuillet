#!/usr/bin/env node
// server/texlive/server.js
// Feuillet TeX Live compile server. Speaks the TeXlyre typesetter protocol
// over WebSocket: each request carries the project files (or only the changed
// ones plus a manifest), the reply carries the PDF and its SyncTeX data.
// Every connection gets its own working tree, so auxiliary files survive
// between compiles and only edited files travel.
//
// Compiles run latexmk without rc files and without -shell-escape (TeX Live's
// restricted shell escape stays in force), one at a time per connection and
// at most MAX_CONCURRENT at once, each bounded by COMPILE_TIMEOUT_MS.
//
// Environment:
//   HOST, PORT          listen address (default 0.0.0.0:7045)
//   ALLOWED_ORIGINS     comma-separated browser origins allowed to connect;
//                       empty allows any origin (local development only)
//   WORK_DIR            root of the per-connection working trees (default ./work)
//   MAX_CONCURRENT      compiles running at once (default 2)
//   MAX_QUEUE           compiles waiting for a slot before refusing (default 20)
//   MAX_CONNECTIONS     open connections (default 100)
//   COMPILE_TIMEOUT_MS  per-compile limit (default 180000)
//   IDLE_TIMEOUT_MS     closes connections without requests (default 900000)
//   MAX_MESSAGE_BYTES   largest accepted request (default 100 MiB)

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const readInt = (name, fallback) =>
	Number.parseInt(process.env[name] || String(fallback), 10);

const host = process.env.HOST || '0.0.0.0';
const port = readInt('PORT', 7045);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
	.split(',')
	.map((origin) => origin.trim())
	.filter(Boolean);
const workDir = path.resolve(process.env.WORK_DIR || 'work');
const maxConcurrent = readInt('MAX_CONCURRENT', 2);
const maxQueue = readInt('MAX_QUEUE', 20);
const maxConnections = readInt('MAX_CONNECTIONS', 100);
const compileTimeoutMs = readInt('COMPILE_TIMEOUT_MS', 180_000);
const idleTimeoutMs = readInt('IDLE_TIMEOUT_MS', 900_000);
const maxPayload = readInt('MAX_MESSAGE_BYTES', 100 * 1024 * 1024);

const MISSING_FILES_STATUS = -2;
const MAX_LOG_CHARS = 1024 * 1024;

// latexmk reads latexmkrc files (Perl) from the project directory, so rc
// files are never read (-norc) and every option is given here.
const ENGINE_ARGS = {
	pdflatex: ['-pdf'],
	lualatex: ['-pdflua', '-lualatex=lualatex --nosocket %O %S'],
	xelatex: ['-pdfxe'],
};

const log = (...parts) =>
	console.log(new Date().toISOString(), '[texlive]', ...parts);

const isAllowedOrigin = (origin) =>
	allowedOrigins.length === 0 || allowedOrigins.includes(origin);

const reject = (socket, status, reason) => {
	socket.write(
		`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
	);
	socket.destroy();
};

const exists = (filePath) =>
	fs.access(filePath).then(
		() => true,
		() => false,
	);

// Compile slots shared by all connections.
let running = 0;
const waiting = [];

const acquireSlot = () => {
	if (running < maxConcurrent) {
		running++;
		return Promise.resolve();
	}
	if (waiting.length >= maxQueue) {
		return Promise.reject(
			new Error('The TeX Live server is busy. Try again in a moment.'),
		);
	}
	return new Promise((resolve) => waiting.push(resolve));
};

const releaseSlot = () => {
	const next = waiting.shift();
	if (next) next();
	else running--;
};

class Session {
	constructor() {
		this.dir = path.join(workDir, crypto.randomUUID());
		this.tracked = new Set();
		this.child = null;
		this.closed = false;
	}

	resolve(filePath) {
		const relative = path.posix.normalize(
			String(filePath).replaceAll('\\', '/').replace(/^\/+/, ''),
		);
		if (!relative || relative === '.' || relative.split('/').includes('..')) {
			throw new Error(`Invalid file path: ${filePath}`);
		}
		return { relative, absolute: path.join(this.dir, relative) };
	}

	async reset() {
		await fs.rm(this.dir, { recursive: true, force: true });
		this.tracked.clear();
	}

	// Without a manifest the request holds the whole project; with one, it
	// holds the changed files and lists every file the project should have.
	async sync(files, manifest) {
		if (!manifest) await this.reset();
		await fs.mkdir(this.dir, { recursive: true });

		if (manifest) {
			const listed = new Set(
				manifest.map((entry) => this.resolve(entry.path).relative),
			);
			for (const relative of this.tracked) {
				if (listed.has(relative)) continue;
				await fs.rm(path.join(this.dir, relative), { force: true });
				this.tracked.delete(relative);
			}
		}

		for (const file of files) {
			const { relative, absolute } = this.resolve(file.path);
			await fs.mkdir(path.dirname(absolute), { recursive: true });
			await fs.writeFile(absolute, Buffer.from(file.content, 'base64'));
			this.tracked.add(relative);
		}

		if (!manifest) return [];
		const missing = [];
		for (const entry of manifest) {
			const { relative, absolute } = this.resolve(entry.path);
			if (await exists(absolute)) this.tracked.add(relative);
			else missing.push(entry.path);
		}
		return missing;
	}

	run(args, cwd) {
		return new Promise((resolve) => {
			const child = spawn('latexmk', args, {
				cwd,
				detached: true,
				env: {
					PATH: process.env.PATH,
					HOME: process.env.HOME,
					LANG: 'C.UTF-8',
				},
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			this.child = child;
			const chunks = [];
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				this.kill();
			}, compileTimeoutMs);

			child.stdout.on('data', (chunk) => chunks.push(chunk));
			child.stderr.on('data', (chunk) => chunks.push(chunk));
			child.on('error', (error) => chunks.push(Buffer.from(error.message)));
			child.on('close', (code) => {
				clearTimeout(timer);
				this.child = null;
				let output = Buffer.concat(chunks).toString('utf8');
				if (output.length > MAX_LOG_CHARS) {
					output = output.slice(-MAX_LOG_CHARS);
				}
				if (timedOut) {
					output += `\nCompilation stopped after ${Math.round(compileTimeoutMs / 1000)} seconds.`;
				}
				resolve({ status: timedOut ? 1 : (code ?? 1), log: output });
			});
		});
	}

	kill() {
		if (!this.child) return;
		try {
			// latexmk starts the engines in its process group.
			process.kill(-this.child.pid, 'SIGKILL');
		} catch {
			// Already gone.
		}
	}

	async compile(mainFile, format, options) {
		const { absolute: source } = this.resolve(mainFile);
		if (!(await exists(source))) {
			return { status: 1, log: `Main file not found: ${mainFile}`, format };
		}

		const engine = Object.hasOwn(ENGINE_ARGS, options.engine)
			? options.engine
			: 'pdflatex';
		const args = [
			'-norc',
			...ENGINE_ARGS[engine],
			'-interaction=nonstopmode',
			'-file-line-error',
			'-halt-on-error',
			'-synctex=1',
			path.basename(source),
		];
		const directory = path.dirname(source);
		const jobName = path.basename(source, path.extname(source));
		const started = Date.now();
		const { status, log: output } = await this.run(args, directory);
		log(
			`compiled with ${engine}: status ${status} in ${Date.now() - started} ms`,
		);

		const pdfPath = path.join(directory, `${jobName}.pdf`);
		if (status !== 0 || !(await exists(pdfPath))) {
			return { status: status || 1, log: output, format };
		}

		const artifacts = [];
		const synctexPath = path.join(directory, `${jobName}.synctex.gz`);
		if (await exists(synctexPath)) {
			artifacts.push({
				id: 'synctex',
				name: `${jobName}.synctex.gz`,
				mimeType: 'application/gzip',
				data: (await fs.readFile(synctexPath)).toString('base64'),
			});
		}

		return {
			status: 0,
			log: output,
			format,
			mimeType: 'application/pdf',
			output: (await fs.readFile(pdfPath)).toString('base64'),
			artifacts,
		};
	}

	async handle(request) {
		const format = typeof request.format === 'string' ? request.format : 'pdf';
		const options =
			request.options && typeof request.options === 'object'
				? request.options
				: {};

		if (options.action === 'clear-cache') {
			await this.reset();
			return { status: 0, log: '', format };
		}
		if (typeof request.mainFile !== 'string' || !Array.isArray(request.files)) {
			return { status: 1, log: 'Malformed compile request.', format };
		}

		const manifest = Array.isArray(request.manifest) ? request.manifest : null;
		const missing = await this.sync(request.files, manifest);
		if (missing.length > 0) {
			return { status: MISSING_FILES_STATUS, log: '', format, missing };
		}

		await acquireSlot();
		try {
			if (this.closed) return { status: 1, log: 'Connection closed.', format };
			return await this.compile(request.mainFile, format, options);
		} finally {
			releaseSlot();
		}
	}

	async close() {
		this.closed = true;
		this.kill();
		await fs.rm(this.dir, { recursive: true, force: true });
	}
}

const server = http.createServer((req, res) => {
	if ((req.url || '').split('?')[0] === '/health') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				status: 'ok',
				connections: wss.clients.size,
				compiling: running,
				queued: waiting.length,
			}),
		);
		return;
	}
	res.writeHead(404, { 'Content-Type': 'text/plain' });
	res.end('Feuillet TeX Live server\n');
});

const wss = new WebSocketServer({ noServer: true, maxPayload });

server.on('upgrade', (req, socket, head) => {
	const origin = req.headers.origin || '';
	if (!isAllowedOrigin(origin)) {
		log('rejected origin', JSON.stringify(origin));
		reject(socket, 403, 'Forbidden');
		return;
	}
	if ((req.url || '').split('?')[0] !== '/') {
		reject(socket, 404, 'Not Found');
		return;
	}
	if (wss.clients.size >= maxConnections) {
		reject(socket, 503, 'Service Unavailable');
		return;
	}
	wss.handleUpgrade(req, socket, head, (conn) => {
		wss.emit('connection', conn, req);
	});
});

wss.on('connection', (conn) => {
	const session = new Session();
	let queue = Promise.resolve();
	let idleTimer = null;

	const resetIdleTimer = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => conn.close(1000, 'Idle'), idleTimeoutMs);
	};
	resetIdleTimer();

	conn.on('message', (data) => {
		resetIdleTimer();
		queue = queue.then(async () => {
			let request;
			try {
				request = JSON.parse(data.toString('utf8'));
			} catch {
				return;
			}
			const requestId = request?.requestId;
			if (typeof requestId !== 'string') return;

			let response;
			try {
				response = await session.handle(request);
			} catch (error) {
				response = {
					status: 1,
					log: error instanceof Error ? error.message : String(error),
					format: request.format,
				};
			}
			if (conn.readyState === conn.OPEN) {
				conn.send(JSON.stringify({ requestId, ...response }));
			}
		});
	});

	conn.on('close', () => {
		clearTimeout(idleTimer);
		void session.close();
	});
});

const start = async () => {
	// Working trees of a previous run belong to closed connections. WORK_DIR
	// itself may be a mount point, so only its entries are removed.
	await fs.mkdir(workDir, { recursive: true });
	for (const entry of await fs.readdir(workDir)) {
		await fs.rm(path.join(workDir, entry), { recursive: true, force: true });
	}
	server.listen(port, host, () => {
		log(
			`listening on ${host}:${port};`,
			allowedOrigins.length > 0
				? `origins: ${allowedOrigins.join(', ')};`
				: 'any origin;',
			`${maxConcurrent} concurrent compiles, ${compileTimeoutMs / 1000}s each;`,
			`work in ${workDir}`,
		);
	});
};

const shutdown = (signal) => {
	log(`${signal} received, closing`);
	for (const client of wss.clients) client.close(1001, 'Server restarting');
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

void start();
