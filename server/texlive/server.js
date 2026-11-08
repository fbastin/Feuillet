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
// As Overleaf's « Other logs and files », each reply lists the files the
// compiles wrote (the .bbl arXiv asks for, the whole .log, the .aux...), and
// a request {"options": {"action": "output-file", "path": ...}} brings one.
//
// Compiles run latexmk without rc files, but rules of its own for glossaries
// and nomenclatures. As on Overleaf, documents may run programs (-shell-escape:
// Inkscape for the svg package, TikZ's externalization, PythonTeX...) once
// the server has no network, so that neither can a document: Docker gives it
// none (deploy/docker-compose.yml) and it is reached through a Unix socket.
// With a network, TeX Live's restricted shell escape stays in force. Compiles
// run one at a time per connection and
// at most MAX_CONCURRENT at once, each bounded by COMPILE_TIMEOUT_MS. As on
// Overleaf, a compile may run in draft mode (images drawn as boxes) or stop
// at the first error, and a message {"action": "stop"} stops the compiles a
// connection asked for before it.
//
// As on Overleaf, a project may choose its year of TeX Live: this server is
// the latest, and other years are servers of their own, on sockets of the
// same directory (OTHER_YEARS, deploy/docker-compose.yml). A compile that
// asks for one of them ({"options": {"version": "2025"}}) goes there through
// this connection, which brings its reply back; "latest", or a year no
// server offers, compiles here. /health says which years there are.
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
//   SOCKET_PATH         a Unix socket to listen on instead of HOST:PORT; the
//                       group of its directory may connect
//   SHELL_ESCAPE        "full" lets documents run programs, if the server has
//                       no network but loopback; "restricted" (default)
//                       keeps TeX Live's list of safe programs
//   SHELL_ESCAPE_ANY_NETWORK  "1" allows "full" with a network (tests only)
//   SESSION_MAX_PROCESSES  processes each connection may run at once, when
//                       running as root (default 64)
//   TEXLIVE_YEAR        this TeX Live's year, when pdftex --version does not
//                       tell it (tests)
//   OTHER_YEARS         the servers of other years, as
//                       2025=/socket/texlive-2025.sock, comma-separated

const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { constants: fsConstants } = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebSocket, WebSocketServer } = require('ws');

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
const socketPath = process.env.SOCKET_PATH || '';
const sessionMaxProcesses = readInt('SESSION_MAX_PROCESSES', 64);
// util-linux's prlimit bounds the processes of each connection.
const hasPrlimit = (() => {
	if (!isolated) return false;
	try {
		execFileSync('prlimit', ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		console.error('prlimit not found: connections are not bounded in processes.');
		return false;
	}
})();

// The network interfaces other than loopback: a document that runs programs
// could reach whatever they reach.
const networkInterfaces = () =>
	Object.entries(os.networkInterfaces())
		.filter(([, addresses]) => (addresses ?? []).some((entry) => !entry.internal))
		.map(([name]) => name);
const shellEscape = (() => {
	if (process.env.SHELL_ESCAPE !== 'full') return 'restricted';
	const reachable = networkInterfaces();
	if (reachable.length === 0 || process.env.SHELL_ESCAPE_ANY_NETWORK === '1') {
		return 'full';
	}
	console.error(
		`Full shell escape refused: this server has a network (${reachable.join(', ')}). Documents keep TeX Live's restricted shell escape.`,
	);
	return 'restricted';
})();
// This TeX Live's year, as its programs say: "pdfTeX 3.141592653-2.6-1.40.28
// (TeX Live 2026)".
const ownYear = (() => {
	if (/^\d{4}$/.test(process.env.TEXLIVE_YEAR || '')) {
		return process.env.TEXLIVE_YEAR;
	}
	try {
		const banner = execFileSync('pdftex', ['--version'], { encoding: 'utf8' });
		return /TeX Live (\d{4})/.exec(banner)?.[1] ?? '';
	} catch {
		return '';
	}
})();
// The other years' servers, by year.
const otherYears = new Map(
	(process.env.OTHER_YEARS || '')
		.split(',')
		.map((entry) => entry.split('=').map((part) => part.trim()))
		.filter(
			([year, socket]) => /^\d{4}$/.test(year) && socket && year !== ownYear,
		),
);
const offeredYears = [...new Set([ownYear, ...otherYears.keys()])]
	.filter(Boolean)
	.map(Number)
	.sort((a, b) => b - a);

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
// The files of the working tree a reply lists, and the largest one sent.
const MAX_OUTPUT_FILES = 200;
const MAX_OUTPUT_DEPTH = 8;
const MAX_OUTPUT_FILE_BYTES = 64 * 1024 * 1024;

// latexmk reads latexmkrc files (Perl) from the project directory, so rc
// files are never read (-norc) and every option is given here. %P is the
// source, after the code of draft mode when there is some.
//
// As on Overleaf, glossaries (the main one, acronyms, symbols, numbers) and
// nomencl's nomenclature are made between runs. Not with makeglossaries: it
// runs makeindex through a shell, with options the document writes in its
// .aux (\@gls@extramakeindexopts), which would let a document run any
// command. These rules run makeindex itself, without a shell, on the job's
// own files, with the style the .aux names only if it is a plain file name
// (xindy and bib2gls are not run).
const GLOSSARY_RULES = String.raw`
sub feuillet_aux {
	my ($base) = @_;
	open(my $fh, '<', "$base.aux") or return '';
	local $/;
	my $text = <$fh>;
	close($fh);
	return $text;
}
sub feuillet_ist {
	my ($base) = @_;
	my ($ist) = feuillet_aux($base) =~ /\\\@istfilename\s*\{([^}]*)\}/;
	$ist = '' unless defined $ist;
	$ist =~ s/^"(.*)"\.ist$/$1.ist/;
	return $ist =~ /^[\w.-]+\.ist$/ ? $ist : "$base.ist";
}
sub feuillet_makeindex {
	my ($base, $in, $out, $log, $style) = @_;
	return system('makeindex', '-s', $style, '-t', "$base.$log", '-o', "$base.$out", "$base.$in");
}
sub feuillet_glo { return feuillet_makeindex($_[0], 'glo', 'gls', 'glg', feuillet_ist($_[0])); }
sub feuillet_acn { return feuillet_makeindex($_[0], 'acn', 'acr', 'alg', feuillet_ist($_[0])); }
sub feuillet_slo { return feuillet_makeindex($_[0], 'slo', 'sls', 'slg', feuillet_ist($_[0])); }
sub feuillet_nlo {
	my $numbers = feuillet_aux($_[0]) =~ /\\\@newglossary\s*\{numbers\}/;
	return feuillet_makeindex($_[0], 'nlo', 'nls', 'nlg', $numbers ? feuillet_ist($_[0]) : 'nomencl.ist');
}
add_cus_dep('glo', 'gls', 0, 'feuillet_glo');
add_cus_dep('acn', 'acr', 0, 'feuillet_acn');
add_cus_dep('slo', 'sls', 0, 'feuillet_slo');
add_cus_dep('nlo', 'nls', 0, 'feuillet_nlo');
`;

// LaTeX goes through DVI and PostScript, as Overleaf's "LaTeX" and arXiv's
// latex+dvips_ps2pdf, for PSTricks and other PostScript code.
const ENGINE_ARGS = {
	pdflatex: ['-pdf'],
	latex: ['-pdfps'],
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

// Project files kept between connections, by content, for each project (the
// client's cacheScope, which only its members know): a project reopened
// sends only what changed since, not all of it again. Only this server reads
// the folder (0700): compiles, with shell escape, run under other uids. Files
// unused for FILE_CACHE_DAYS go, and the oldest past FILE_CACHE_MB in all.
const fileCacheDir = process.env.FILE_CACHE_DIR
	? path.resolve(process.env.FILE_CACHE_DIR)
	: '';
const fileCacheBytes = readInt('FILE_CACHE_MB', 2048) * 1024 * 1024;
const fileCacheDays = readInt('FILE_CACHE_DAYS', 7);
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const fileCache = {
	enabled: Boolean(fileCacheDir),
	added: 0,
	scopeDir(scope) {
		return path.join(fileCacheDir, sha256(`feuillet-scope:${scope}`).slice(0, 40));
	},
	// Kept under its own hash, whatever a client says it is.
	async put(scope, bytes) {
		const dir = this.scopeDir(scope);
		const target = path.join(dir, sha256(bytes));
		if (await exists(target)) {
			await this.touch(target);
			return;
		}
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		const partial = `${target}.${crypto.randomUUID()}.part`;
		await fs.writeFile(partial, bytes, { mode: 0o600 });
		await fs.rename(partial, target);
		this.added += bytes.length;
		if (this.added > fileCacheBytes / 10) {
			this.added = 0;
			void this.prune().catch((error) => log('file cache prune:', error.message));
		}
	},
	// The file of that hash, if the project's cache has it.
	async read(scope, hash) {
		if (!/^[0-9a-f]{64}$/.test(String(hash))) return null;
		const source = path.join(this.scopeDir(scope), hash);
		const bytes = await fs.readFile(source).catch(() => null);
		if (bytes) await this.touch(source);
		return bytes;
	},
	async touch(file) {
		const now = new Date();
		await fs.utimes(file, now, now).catch(() => {});
	},
	async prune() {
		const files = [];
		for (const scope of await fs.readdir(fileCacheDir).catch(() => [])) {
			const dir = path.join(fileCacheDir, scope);
			for (const name of await fs.readdir(dir).catch(() => [])) {
				const file = path.join(dir, name);
				const stat = await fs.stat(file).catch(() => null);
				if (stat?.isFile()) files.push({ file, size: stat.size, used: stat.mtimeMs });
			}
		}
		const oldest = Date.now() - fileCacheDays * 24 * 3600 * 1000;
		files.sort((a, b) => a.used - b.used);
		let total = files.reduce((sum, entry) => sum + entry.size, 0);
		for (const entry of files) {
			if (entry.used >= oldest && total <= fileCacheBytes * 0.9) break;
			await fs.rm(entry.file, { force: true });
			total -= entry.size;
		}
	},
};

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

	// Writes a project file at its path in the working tree without going
	// through a link: compiles (with shell escape) may have put links there,
	// and this server writes as root. Each folder on the way is a real one
	// (a link or a file in its place is removed); the file is written new,
	// then renamed onto its path, which replaces a link rather than follow
	// it.
	async placeFile(relative, bytes) {
		let parent = this.dir;
		const parts = relative.split('/');
		for (const part of parts.slice(0, -1)) {
			const next = path.join(parent, part);
			const stat = await fs.lstat(next).catch(() => null);
			if (stat && !stat.isDirectory()) {
				await fs.rm(next, { recursive: true, force: true });
			}
			if (!stat || !stat.isDirectory()) {
				await fs.mkdir(next, { mode: 0o700 });
				await this.own(next);
			}
			parent = next;
		}
		const target = path.join(parent, parts[parts.length - 1]);
		const partial = path.join(parent, `.feuillet-${crypto.randomUUID()}`);
		const handle = await fs.open(
			partial,
			fsConstants.O_WRONLY |
				fsConstants.O_CREAT |
				fsConstants.O_EXCL |
				fsConstants.O_NOFOLLOW,
			0o644,
		);
		try {
			await handle.writeFile(bytes);
		} finally {
			await handle.close();
		}
		await this.own(partial);
		const existing = await fs.lstat(target).catch(() => null);
		if (existing?.isDirectory()) {
			await fs.rm(target, { recursive: true, force: true });
		}
		await fs.rename(partial, target);
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
	async sync(files, manifest, scope = null) {
		const cached = Boolean(scope) && fileCache.enabled;
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
			const { relative } = this.resolve(file.path);
			const bytes = Buffer.from(file.content, 'base64');
			await this.placeFile(relative, bytes);
			this.tracked.add(relative);
			if (cached) {
				await fileCache.put(scope, bytes).catch((error) => log('file cache:', error.message));
			}
		}

		if (!manifest) return [];
		const missing = [];
		for (const entry of manifest) {
			const { relative, absolute } = this.resolve(entry.path);
			if (await exists(absolute)) {
				this.tracked.add(relative);
				continue;
			}
			// Sent before, in another connection: from the project's cache.
			if (cached) {
				const bytes = await fileCache.read(scope, entry.hash);
				if (bytes) {
					await this.placeFile(relative, bytes);
					this.tracked.add(relative);
					continue;
				}
			}
			missing.push(entry.path);
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
			// Under its own uid, a connection runs a bounded number of
			// processes, which a document running programs cannot exceed.
			const [command, commandArgs] =
				this.uid === null || !hasPrlimit
					? ['latexmk', args]
					: [
							'prlimit',
							[
								`--nproc=${sessionMaxProcesses}:${sessionMaxProcesses}`,
								'--',
								'latexmk',
								...args,
							],
						];
			const child = spawn(command, commandArgs, {
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

	// The files the compiles wrote: those of the working tree that are not
	// the project's, but the PDF the reply carries. Links are left out.
	async outputFiles(pdfRelative) {
		const found = [];
		const walk = async (directory, prefix, depth) => {
			const entries = await fs
				.readdir(directory, { withFileTypes: true })
				.catch(() => []);
			for (const entry of entries) {
				if (found.length >= MAX_OUTPUT_FILES) return;
				const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory()) {
					if (depth < MAX_OUTPUT_DEPTH) {
						await walk(path.join(directory, entry.name), relative, depth + 1);
					}
				} else if (
					entry.isFile() &&
					relative !== pdfRelative &&
					!this.tracked.has(relative)
				) {
					const stats = await fs
						.lstat(path.join(directory, entry.name))
						.catch(() => null);
					if (stats?.isFile()) found.push({ path: relative, size: stats.size });
				}
			}
		};
		await walk(this.dir, '', 0);
		return found.sort((a, b) => a.path.localeCompare(b.path));
	}

	// One of them, read as a file of the working tree only: neither a
	// project file nor a link, nor a path through one.
	async outputFile(filePath, format) {
		const gone = { status: 1, log: `Output file not found: ${filePath}`, format };
		let target;
		try {
			const { relative, absolute } = this.resolve(filePath);
			if (this.tracked.has(relative)) return gone;
			const root = await fs.realpath(this.dir);
			const parent = await fs.realpath(path.dirname(absolute));
			if (parent !== root && !parent.startsWith(root + path.sep)) return gone;
			target = path.join(parent, path.basename(absolute));
		} catch {
			return gone;
		}
		let handle;
		try {
			handle = await fs.open(
				target,
				fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
			);
			const stats = await handle.stat();
			if (!stats.isFile()) return gone;
			if (stats.size > MAX_OUTPUT_FILE_BYTES) {
				return { status: 1, log: `Output file too large: ${filePath}`, format };
			}
			return {
				status: 0,
				log: '',
				format,
				mimeType: 'application/octet-stream',
				output: (await handle.readFile()).toString('base64'),
			};
		} catch {
			return gone;
		} finally {
			await handle?.close();
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
			'-e',
			GLOSSARY_RULES,
			...(shellEscape === 'full' ? ['-shell-escape'] : []),
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
		// Nothing a compile started goes on once it ends.
		if (this.uid !== null) await killUid(this.uid);
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

		const pdfRelative = path.relative(this.dir, pdfPath).split(path.sep).join('/');
		const listed = {
			id: 'output-files',
			name: 'output-files.json',
			mimeType: 'application/json',
			data: Buffer.from(
				JSON.stringify(await this.outputFiles(pdfRelative)),
			).toString('base64'),
		};

		if (!(await exists(pdfPath))) {
			return { status: status || 1, log: report, format, artifacts: [listed] };
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
		artifacts.push(listed);

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
		if (options.action === 'output-file') {
			return this.outputFile(options.path, format);
		}
		if (typeof request.mainFile !== 'string' || !Array.isArray(request.files)) {
			return { status: 1, log: 'Malformed compile request.', format };
		}

		const manifest = Array.isArray(request.manifest) ? request.manifest : null;
		const scope =
			typeof request.cacheScope === 'string' &&
			request.cacheScope.length > 0 &&
			request.cacheScope.length <= 200
				? request.cacheScope
				: null;
		const missing = await this.sync(request.files, manifest, scope);
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

// A connection to another year's server, for one connection to this one:
// requests go there as they came, and their replies come back as they are.
class Relay {
	constructor(year, origin) {
		this.year = year;
		this.pending = new Map();
		this.closed = false;
		this.socket = new WebSocket(`ws+unix://${otherYears.get(year)}:/`, {
			headers: origin ? { Origin: origin } : {},
			maxPayload: 8 * maxPayload,
		});
		this.opened = new Promise((resolve) => {
			this.socket.once('open', () => resolve(true));
			this.socket.once('close', () => resolve(false));
		});
		// Its errors close it; they are told by the replies.
		this.socket.on('error', () => {});
		this.socket.on('message', (data, isBinary) => {
			let requestId;
			try {
				requestId = JSON.parse(data.toString('utf8'))?.requestId;
			} catch {
				return;
			}
			const done = this.pending.get(requestId);
			if (!done) return;
			this.pending.delete(requestId);
			done({ data, isBinary });
		});
		this.socket.on('close', () => {
			this.closed = true;
			for (const done of this.pending.values()) done(null);
			this.pending.clear();
		});
	}

	// The reply to a request, or null when that server could not answer.
	async send(requestId, data) {
		if (!(await this.opened) || this.closed) return null;
		return new Promise((resolve) => {
			this.pending.set(requestId, resolve);
			this.socket.send(data, { binary: false });
		});
	}

	// A message without a reply, as a stop.
	tell(data) {
		if (this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(data, { binary: false });
		}
	}

	close() {
		this.socket.close();
	}
}

// Where a compile goes: '' here, or another year's server. A year that no
// server offers, as one a project kept from before an update, compiles here.
const targetOf = (version) =>
	typeof version === 'string' && otherYears.has(version) ? version : '';

// Health is read across origins by the pages that offer the years.
const allowHealthOrigin = (req, res) => {
	const origin = req.headers.origin || '';
	if (!origin) return;
	if (allowedOrigins.length === 0) {
		res.setHeader('Access-Control-Allow-Origin', '*');
	} else if (allowedOrigins.includes(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	}
};

const server = http.createServer((req, res) => {
	if ((req.url || '').split('?')[0] === '/health') {
		allowHealthOrigin(req, res);
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				status: 'ok',
				connections: wss.clients.size,
				compiling: running,
				queued: waiting.length,
				shellEscape,
				// This server's TeX Live, then the years a compile may ask for.
				year: ownYear ? Number(ownYear) : null,
				years: offeredYears,
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

wss.on('connection', (conn, req) => {
	const uid = isolated ? freeUids.shift() : null;
	if (uid === undefined) {
		// Closing connections give their uid back once their files are gone.
		conn.close(1013, 'Too many connections');
		return;
	}
	const session = new Session(uid);
	let queue = Promise.resolve();
	let idleTimer = null;
	// The other years' servers this connection compiled with, and where its
	// last compile went ('' here), which has the files the next one builds on.
	const relays = new Map();
	let target = '';
	const relayTo = (year) => {
		let relay = relays.get(year);
		if (!relay || relay.closed) {
			relay = new Relay(year, req.headers.origin || '');
			relays.set(year, relay);
		}
		return relay;
	};

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
		// Not queued: it stops what is running, here and on other years'.
		if (request?.action === 'stop') {
			session.stop(seq);
			for (const relay of relays.values()) relay.tell(data);
			return;
		}
		const requestId = request?.requestId;
		if (typeof requestId !== 'string') return;

		queue = queue.then(async () => {
			const options =
				request.options && typeof request.options === 'object'
					? request.options
					: {};
			// Asking for a file, or to clear the cache: the last compile's server.
			const to = options.action ? target : targetOf(options.version);
			let response;
			if (to !== target) {
				target = to;
				// That server's files are not this project's latest: all of them
				// are sent again, as to a new connection.
				const { files, manifest } = request;
				if (
					Array.isArray(manifest) &&
					Array.isArray(files) &&
					files.length < manifest.length
				) {
					response = {
						status: MISSING_FILES_STATUS,
						log: '',
						format: request.format,
						missing: manifest.map((entry) => entry?.path),
					};
				}
			}
			if (!response && to) {
				const reply = await relayTo(to).send(requestId, data);
				if (reply) {
					if (conn.readyState === conn.OPEN) {
						conn.send(reply.data, { binary: reply.isBinary });
					}
					return;
				}
				response = {
					status: 1,
					log: formatLog({
						engine: String(options.engine ?? 'pdflatex'),
						source: path.posix.basename(String(request.mainFile ?? '')),
						status: 1,
						transcript: '',
						output: '',
						errors: [
							`TeX Live ${to} cannot be reached right now. Try again in a moment, or choose another TeX Live version.`,
						],
					}),
					format: request.format,
				};
			}
			if (!response) {
				try {
					response = await session.handle(request, seq);
				} catch (error) {
					response = {
						status: 1,
						log: error instanceof Error ? error.message : String(error),
						format: request.format,
					};
				}
			}
			if (conn.readyState === conn.OPEN) {
				conn.send(JSON.stringify({ requestId, ...response }));
			}
		});
	});

	conn.on('close', () => {
		clearTimeout(idleTimer);
		for (const relay of relays.values()) relay.close();
		void session.close();
	});
});

const start = async () => {
	// Working trees of a previous run belong to closed connections. WORK_DIR
	// itself may be a mount point, so only its entries are removed.
	if (fileCacheDir) {
		await fs.mkdir(fileCacheDir, { recursive: true, mode: 0o700 });
		await fs.chmod(fileCacheDir, 0o700);
		await fileCache.prune().catch((error) => log('file cache prune:', error.message));
		setInterval(
			() => void fileCache.prune().catch((error) => log('file cache prune:', error.message)),
			3600 * 1000,
		).unref();
	}
	await fs.mkdir(workDir, { recursive: true });
	for (const entry of await fs.readdir(workDir)) {
		await fs.rm(path.join(workDir, entry), { recursive: true, force: true });
	}
	// Session uids may cross WORK_DIR but not list it.
	if (isolated) await fs.chmod(workDir, 0o711);
	const listening = () =>
		log(
			`listening on ${socketPath || `${host}:${port}`};`,
			allowedOrigins.length > 0
				? `origins: ${allowedOrigins.join(', ')};`
				: 'any origin;',
			`${maxConcurrent} concurrent compiles, ${compileTimeoutMs / 1000}s each;`,
			isolated
				? `one uid per connection from ${sessionUidBase}${hasPrlimit ? `, ${sessionMaxProcesses} processes each` : ''};`
				: 'compiles share the server user;',
			shellEscape === 'full'
				? 'documents may run programs (no network);'
				: 'restricted shell escape;',
			`TeX Live ${ownYear || '(year unknown)'}${otherYears.size > 0 ? `, and ${[...otherYears.keys()].join(', ')} on their servers` : ''};`,
			`work in ${workDir}`,
		);
	if (!socketPath) {
		server.listen(port, host, listening);
		return;
	}
	// Longer, the system would cut it and listen elsewhere.
	if (Buffer.byteLength(socketPath) > 107) {
		throw new Error(`SOCKET_PATH is longer than 107 bytes: ${socketPath}`);
	}
	// The socket of a previous run, then this one, for the group of its
	// directory (Apache and the collaboration server), not the compiles.
	await fs.rm(socketPath, { force: true });
	const { gid } = await fs.stat(path.dirname(socketPath));
	server.listen(socketPath, async () => {
		await fs.chmod(socketPath, 0o660);
		if (isolated) await fs.chown(socketPath, 0, gid);
		listening();
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
