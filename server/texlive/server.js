#!/usr/bin/env node
// server/texlive/server.js
// Feuillet TeX Live compile server. Speaks the TeXlyre typesetter protocol
// over WebSocket: each request carries the project files (or only the changed
// ones plus a manifest), the reply carries the PDF and its SyncTeX data.
// As on Overleaf, a PDF made despite LaTeX errors comes with them: the reply
// then has both a PDF and a status other than 0. Every connection gets its
// own working tree, so auxiliary files survive between compiles and only
// edited files travel.
//
// Compiles run latexmk without rc files and without -shell-escape (TeX Live's
// restricted shell escape stays in force), one at a time per connection and
// at most MAX_CONCURRENT at once, each bounded by COMPILE_TIMEOUT_MS. As on
// Overleaf, a compile may run in draft mode (images drawn as boxes) or stop
// at the first error, and a message {"action": "stop"} stops the compiles a
// connection asked for before it.
//
// The log has the layout of the busytex harness that Feuillet's LaTeX log
// viewer reads (extras/loggers/latex_visualizer/parser.ts): the viewer lists
// the errors and warnings of the LOG section, the transcript of the last
// pass, and the raw log also shows the output of latexmk.
//
// When the server runs as root (the Docker image), every connection compiles
// under its own unprivileged uid, in a directory only that uid can open, so a
// document cannot reach the files of other connections. Running as another
// user (local development), all compiles share that user.
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
//   SESSION_UID_BASE    first of the MAX_CONNECTIONS uids given to
//                       connections when running as root (default 20000)

const { execFileSync, spawn } = require('node:child_process');
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
const sessionUidBase = readInt('SESSION_UID_BASE', 20000);
const isolated = process.getuid?.() === 0;
// Biber as unpacked when the image was built (check-biber.sh).
const biberDir = process.env.BIBER_DIR || '';

// LuaTeX's font names database, built with the image (Dockerfile).
const findFontNamesDir = () => {
	try {
		const sysvar = execFileSync('kpsewhich', ['-var-value', 'TEXMFSYSVAR'], {
			encoding: 'utf8',
		}).trim();
		return sysvar ? path.join(sysvar, 'luatex-cache', 'generic', 'names') : '';
	} catch {
		return '';
	}
};
const fontNamesDir = isolated ? findFontNamesDir() : '';

const MISSING_FILES_STATUS = -2;
const MAX_LOG_CHARS = 1024 * 1024;

// latexmk reads latexmkrc files (Perl) from the project directory, so rc
// files are never read (-norc) and every option is given here. %P is the
// source, after the code of draft mode when there is some.
const ENGINE_ARGS = {
	pdflatex: ['-pdf'],
	lualatex: ['-pdflua', '-lualatex=lualatex --nosocket %O %P'],
	xelatex: ['-pdfxe'],
};

// Overleaf's draft mode: images become boxes with their names. The code is
// read before the source, which keeps its line numbers.
const DRAFT_CODE =
	'\\PassOptionsToPackage{draft}{graphicx}\\PassOptionsToPackage{draft}{graphics}';

const log = (...parts) =>
	console.log(new Date().toISOString(), '[texlive]', ...parts);

const lastChars = (text) =>
	text.length > MAX_LOG_CHARS ? text.slice(-MAX_LOG_CHARS) : text;

const formatLog = ({ engine, source, status, transcript, output, errors }) =>
	[
		`$ ${engine} ${source} (latexmk)`,
		`EXITCODE: ${status}`,
		'',
		'LOG:',
		transcript,
		// Failures the transcript does not show, as TeX errors for the viewer.
		...errors.map((error) => `! ${error}`),
		'==',
		'STDOUT:',
		output,
		'======',
	].join('\n');

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

// When a file was last written, or null if there is none.
const writtenAt = (filePath) =>
	fs.stat(filePath).then(
		(stats) => stats.mtimeMs,
		() => null,
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

// Session uids, reused in the order they were released.
const freeUids = isolated
	? Array.from({ length: maxConnections }, (_, index) => sessionUidBase + index)
	: [];

// Stops whatever a session uid left running before the uid is reused.
const killUid = async (uid) => {
	for (const entry of await fs.readdir('/proc')) {
		if (!/^\d+$/.test(entry)) continue;
		const status = await fs
			.readFile(`/proc/${entry}/status`, 'utf8')
			.catch(() => '');
		if (Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) !== uid) continue;
		try {
			process.kill(Number(entry), 'SIGKILL');
		} catch {
			// Already gone.
		}
	}
};

class Session {
	// uid is null when compiles run as the server's own user.
	constructor(uid) {
		this.uid = uid;
		this.root = path.join(workDir, crypto.randomUUID());
		this.dir = path.join(this.root, 'project');
		this.home = path.join(this.root, 'home');
		this.tmp = path.join(this.home, 'tmp');
		this.biber = path.join(this.home, 'biber');
		this.texmfVar = path.join(this.home, 'texmf-var');
		this.fontNames = path.join(
			this.texmfVar,
			'luatex-cache',
			'generic',
			'names',
		);
		this.tracked = new Set();
		this.child = null;
		this.closed = false;
		// Requests are numbered as they arrive: a stop stops those before it.
		this.received = 0;
		this.stoppedBefore = 0;
		this.current = 0;
		// The options of each main file's last compile, which latexmk does
		// not compare.
		this.settings = new Map();
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

	async own(target) {
		if (this.uid !== null) await fs.chown(target, this.uid, this.uid);
	}

	// Creates a directory and its missing parents, owned by the session uid.
	async makeDir(directory) {
		const created = await fs.mkdir(directory, { recursive: true, mode: 0o700 });
		if (!created) return;
		for (let current = directory; ; current = path.dirname(current)) {
			await this.own(current);
			if (current === created || current === path.dirname(current)) break;
		}
	}

	// Links files prepared with the image into a directory of the session
	// uid, where the programs using them can add files of their own.
	async linkInto(source, target, keep) {
		if (await exists(target)) return;
		const entries = await fs.readdir(source).catch(() => []);
		await this.makeDir(target);
		for (const entry of entries) {
			if (!keep(entry)) continue;
			await fs.symlink(path.join(source, entry), path.join(target, entry));
		}
	}

	async linkShared() {
		if (this.uid === null) return;
		// Biber's packer locks a file next to its unpacked copy at every run.
		if (biberDir) {
			await this.linkInto(
				biberDir,
				this.biber,
				(entry) => entry !== 'inc.lock',
			);
		}
		// luaotfload reads its font names database only from the cache it
		// may write to, and rebuilds it there when missing (about 12 s).
		if (fontNamesDir) {
			await this.linkInto(fontNamesDir, this.fontNames, (entry) =>
				entry.startsWith('luaotfload-names'),
			);
		}
	}

	async reset() {
		await fs.rm(this.dir, { recursive: true, force: true });
		this.tracked.clear();
		this.settings.clear();
	}

	get stopped() {
		return this.current < this.stoppedBefore;
	}

	// Stops the compile running, and those waiting, asked for before `seq`.
	stop(seq) {
		this.stoppedBefore = seq;
		if (this.stopped) this.kill();
	}

	// Without a manifest the request holds the whole project; with one, it
	// holds the changed files and lists every file the project should have.
	async sync(files, manifest) {
		if (!manifest) await this.reset();
		await this.makeDir(this.dir);
		await this.makeDir(this.tmp);
		await this.linkShared();

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
			await this.makeDir(path.dirname(absolute));
			await fs.writeFile(absolute, Buffer.from(file.content, 'base64'));
			await this.own(absolute);
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
		// Unwrapped transcripts, which the log viewer reads more reliably.
		const env = {
			PATH: process.env.PATH,
			LANG: 'C.UTF-8',
			max_print_line: '10000',
		};
		if (this.uid === null) {
			env.HOME = process.env.HOME;
		} else {
			env.HOME = this.home;
			env.TMPDIR = this.tmp;
			env.TEXMFVAR = this.texmfVar;
		}
		if (biberDir) {
			env.PAR_GLOBAL_TEMP = this.uid === null ? biberDir : this.biber;
		}
		return new Promise((resolve) => {
			if (this.stopped) {
				resolve({ status: 1, output: '', timedOut: false, stopped: true });
				return;
			}
			const child = spawn('latexmk', args, {
				cwd,
				detached: true,
				env,
				...(this.uid === null ? {} : { uid: this.uid, gid: this.uid }),
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
				const stopped = !timedOut && this.stopped;
				resolve({
					status: timedOut || stopped ? 1 : (code ?? 1),
					output: lastChars(Buffer.concat(chunks).toString('utf8')),
					timedOut,
					stopped,
				});
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
		const draft = options.mode === 'draft';
		const stopOnFirstError = options.errors === 'stop';
		// latexmk runs LaTeX again when the sources change, not its options.
		const settings = `${engine} ${draft} ${stopOnFirstError}`;
		const changed = (this.settings.get(mainFile) ?? settings) !== settings;
		this.settings.set(mainFile, settings);
		// As on Overleaf, latexmk goes on despite errors (-f): the PDF then has
		// whatever LaTeX could make of the document, references included.
		// Stopping at the first error, LaTeX makes no PDF.
		const args = [
			'-norc',
			stopOnFirstError ? '-halt-on-error' : '-f',
			...(changed ? ['-g'] : []),
			...(draft ? [`-usepretex=${DRAFT_CODE}`] : []),
			...ENGINE_ARGS[engine],
			'-interaction=nonstopmode',
			'-synctex=1',
			path.basename(source),
		];
		const directory = path.dirname(source);
		const jobName = path.basename(source, path.extname(source));
		const pdfPath = path.join(directory, `${jobName}.pdf`);
		const synctexPath = path.join(directory, `${jobName}.synctex.gz`);
		const transcriptPath = path.join(directory, `${jobName}.log`);
		const outputs = [pdfPath, synctexPath];
		const before = await Promise.all(
			[transcriptPath, ...outputs].map(writtenAt),
		);
		const started = Date.now();
		const { status, output, timedOut, stopped } = await this.run(
			args,
			directory,
		);
		log(
			`compiled with ${engine}${draft ? ' (draft)' : ''}: status ${status} in ${Date.now() - started} ms`,
		);

		// The PDF is sent despite errors, so it must be this document's: once
		// LaTeX has run, a PDF or SyncTeX file it did not write again was made
		// from earlier sources, and a stopped run may leave them half written.
		// latexmk leaves them alone when nothing changed, and they stay right.
		const after = await Promise.all(
			[transcriptPath, ...outputs].map(writtenAt),
		);
		const latexRan = after[0] !== before[0];
		for (const [index, filePath] of outputs.entries()) {
			if (
				timedOut ||
				stopped ||
				(latexRan && after[index + 1] === before[index + 1])
			) {
				await fs.rm(filePath, { force: true });
			}
		}

		// Biber names the UTF-8 copy it makes of the .bib file.
		const errors = [...output.matchAll(/^ERROR - (.+)$/gm)].map(
			(match) =>
				`Biber error: ${match[1].replace(/\S*biber_tmp_\S*?\.utf8/g, 'bibliography file')}`,
		);
		if (timedOut) {
			errors.push(
				`Compilation stopped after ${Math.round(compileTimeoutMs / 1000)} seconds.`,
			);
		}
		if (stopped) errors.push('Compilation stopped.');
		// A compile stopped before LaTeX ran has no transcript of its own.
		const transcript =
			stopped && !latexRan
				? ''
				: await fs.readFile(transcriptPath, 'utf8').catch(() => '');
		const report = formatLog({
			engine,
			source: path.basename(source),
			status,
			transcript: lastChars(transcript),
			output,
			errors,
		});

		if (!(await exists(pdfPath))) {
			return { status: status || 1, log: report, format };
		}

		const artifacts = [];
		if (await exists(synctexPath)) {
			artifacts.push({
				id: 'synctex',
				name: `${jobName}.synctex.gz`,
				mimeType: 'application/gzip',
				data: (await fs.readFile(synctexPath)).toString('base64'),
			});
		}

		// A status other than 0 with a PDF: LaTeX reported errors.
		return {
			status,
			log: report,
			format,
			mimeType: 'application/pdf',
			output: (await fs.readFile(pdfPath)).toString('base64'),
			artifacts,
		};
	}

	async handle(request, seq) {
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

		this.current = seq;
		const stoppedReply = () => ({
			status: 1,
			log: formatLog({
				engine: String(options.engine ?? 'pdflatex'),
				source: path.posix.basename(request.mainFile),
				status: 1,
				transcript: '',
				output: '',
				errors: ['Compilation stopped.'],
			}),
			format,
		});
		if (this.stopped) return stoppedReply();
		await acquireSlot();
		try {
			if (this.closed) return { status: 1, log: 'Connection closed.', format };
			if (this.stopped) return stoppedReply();
			return await this.compile(request.mainFile, format, options);
		} finally {
			releaseSlot();
		}
	}

	async close() {
		this.closed = true;
		this.kill();
		if (this.uid !== null) await killUid(this.uid);
		await fs.rm(this.root, { recursive: true, force: true });
		if (this.uid !== null) freeUids.push(this.uid);
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
	const uid = isolated ? freeUids.shift() : null;
	if (uid === undefined) {
		// Closing connections give their uid back once their files are gone.
		conn.close(1013, 'Too many connections');
		return;
	}
	const session = new Session(uid);
	let queue = Promise.resolve();
	let idleTimer = null;

	const resetIdleTimer = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => conn.close(1000, 'Idle'), idleTimeoutMs);
	};
	resetIdleTimer();

	conn.on('message', (data) => {
		resetIdleTimer();
		let request;
		try {
			request = JSON.parse(data.toString('utf8'));
		} catch {
			return;
		}
		const seq = ++session.received;
		// Not queued: it stops what is running.
		if (request?.action === 'stop') {
			session.stop(seq);
			return;
		}
		const requestId = request?.requestId;
		if (typeof requestId !== 'string') return;

		queue = queue.then(async () => {
			let response;
			try {
				response = await session.handle(request, seq);
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
	// Session uids may cross WORK_DIR but not list it.
	if (isolated) await fs.chmod(workDir, 0o711);
	server.listen(port, host, () => {
		log(
			`listening on ${host}:${port};`,
			allowedOrigins.length > 0
				? `origins: ${allowedOrigins.join(', ')};`
				: 'any origin;',
			`${maxConcurrent} concurrent compiles, ${compileTimeoutMs / 1000}s each;`,
			isolated
				? `one uid per connection from ${sessionUidBase};`
				: 'compiles share the server user;',
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
