// server/collab/git.js
// Git access to projects, as Overleaf's Git integration: a project's owner
// and editors clone it, pull and push; its reviewers and readers clone and
// pull it.
//
//   git clone https://<account>@<host>/collab/git/<id>
//
//   GET  /git/<id>/info/refs?service=git-upload-pack|git-receive-pack
//   POST /git/<id>/git-upload-pack
//   POST /git/<id>/git-receive-pack
//
// <id> is any link that opens the project (it may end in .git). Git signs in
// with HTTP Basic: the Feuillet account's name and one of its Git tokens,
// made in the profile (accounts.js), never its password.
//
// Each project has a bare repository, GIT_BRIDGE_DIR/<project>.git, whose
// master branch follows the project. Before each clone, pull and push, the
// project's files as they are now become a commit, "Update from Feuillet",
// when they changed: texts as people read them, comments and tracked
// changes left in Feuillet, tracked changes as made. A push must start from
// the latest commit (git pull first); its changes go into the project at
// once, as the account's own changes, under "Git (<account>)" in the
// project's history: into the documents collaborators have open, where they
// see them, keeping the comments and tracked changes on the text left; and
// files added, replaced and deleted. Only master is kept: no other branch,
// no tags, and no forced push.
//
// Git does the protocol for clones and pulls (git upload-pack); pushes this
// module reads itself, so as to check them before anything changes.

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { cleanView, strip } = require('./annotations');
const { diffWords } = require('./mcp');
const { textOf } = require('./projectFiles');

const ROUTE =
	/^\/git\/([A-Za-z0-9_-]{1,100}?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/;
const SERVICES = ['git-upload-pack', 'git-receive-pack'];
const ZERO = '0'.repeat(40);
const OID = /^[0-9a-f]{40}$/;
const BRANCH = 'refs/heads/master';
const MAX_FETCH_BYTES = 16 * 1024 * 1024;
const MAX_PUSH_BYTES = 512 * 1024 * 1024;
const MAX_PATH = 300;
// Line differences beyond this many go as one change.
const MAX_LINE_EDITS = 2000;
const CAPABILITIES = 'report-status side-band-64k ofs-delta agent=feuillet';
// Authors of the project's history that are pushes, not Feuillet's changes.
const PUSHED_BY = /^Git \(/;

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

// A push refused, told to Git: "! [remote rejected] master (reason)".
class Refusal extends Error {}

const blobId = (bytes) =>
	crypto
		.createHash('sha1')
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest('hex');

const pkt = (data) => {
	const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
	return Buffer.concat([
		Buffer.from((body.length + 4).toString(16).padStart(4, '0'), 'ascii'),
		body,
	]);
};
const FLUSH = Buffer.from('0000', 'ascii');

// The packet lines up to the first flush, and what follows it.
const readPackets = (buffer) => {
	const lines = [];
	let at = 0;
	while (at + 4 <= buffer.length) {
		const size = Number.parseInt(buffer.toString('ascii', at, at + 4), 16);
		if (!Number.isInteger(size) || (size > 0 && size < 4)) break;
		if (size === 0) return { lines, rest: buffer.subarray(at + 4) };
		if (at + size > buffer.length) break;
		lines.push(buffer.subarray(at + 4, at + size));
		at += size;
	}
	throw new HttpError(400, 'This is not a Git push.');
};

// A path Git and Feuillet both accept: relative, without "." or "..",
// nor a ".git" of its own.
const validPath = (name) =>
	typeof name === 'string' &&
	name.length > 0 &&
	name.length < MAX_PATH &&
	// biome-ignore lint/suspicious/noControlCharactersInRegex: refuses them.
	!/[\u0000-\u001f\u007f\\]/.test(name) &&
	name
		.split('/')
		.every(
			(part) =>
				part !== '' &&
				part !== '.' &&
				part !== '..' &&
				part.toLowerCase() !== '.git' &&
				!/^git~\d+$/i.test(part),
		);
// Characters that file names may not have elsewhere (mcp.js refuses them
// too).
const portablePath = (name) => !/[<>:"|?*]/.test(name);

// A path in a fast-import command.
const quotePath = (name) =>
	/^"|["\\]/.test(name) ? `"${name.replace(/["\\]/g, (c) => `\\${c}`)}"` : name;

// A name in a commit: no angle brackets nor line breaks.
const cleanName = (name) =>
	// biome-ignore lint/suspicious/noControlCharactersInRegex: removes them.
	String(name).replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) ||
	'Feuillet';

/**
 * Where list `b` differs from list `a`, as Myers' diff finds it:
 * [{a0, a1, b0, b1}], a[a0..a1) replaced by b[b0..b1); null when there are
 * too many differences to find them.
 */
const diffLists = (a, b) => {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const n = endA - start;
	const m = endB - start;
	if (n === 0 && m === 0) return [];
	if (n === 0 || m === 0) return [{ a0: start, a1: endA, b0: start, b1: endB }];
	const max = n + m;
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	const trace = [];
	let found = -1;
	for (let d = 0; d <= Math.min(max, MAX_LINE_EDITS); d++) {
		trace.push(v.slice(offset - d - 1, offset + d + 2));
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
					? v[offset + k + 1]
					: v[offset + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[start + x] === b[start + y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
		if (found >= 0) break;
	}
	if (found < 0) return null;
	// Back from the end: each step one line removed or added.
	const removed = new Uint8Array(n);
	const added = new Uint8Array(m);
	let x = n;
	let y = m;
	for (let d = found; d > 0; d--) {
		const before = trace[d];
		// trace[d] holds v before step d, for k in [-d-1, d+1].
		const at = (k) => before[k + d + 1];
		const k = x - y;
		const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
		const previousK = down ? k + 1 : k - 1;
		const previousX = at(previousK);
		const previousY = previousX - previousK;
		if (down) added[previousY] = 1;
		else removed[previousX] = 1;
		x = previousX;
		y = previousY;
	}
	const blocks = [];
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && !removed[i] && !added[j]) {
			i++;
			j++;
			continue;
		}
		const block = { a0: start + i, b0: start + j };
		// Lines removed and added in turn make one block.
		while ((i < n && removed[i]) || (j < m && added[j])) {
			while (i < n && removed[i]) i++;
			while (j < m && added[j]) j++;
		}
		if (block.a0 === start + i && block.b0 === start + j) {
			// Not a path through both lists: the rest as one block.
			blocks.push({ ...block, a1: endA, b1: endB });
			break;
		}
		blocks.push({ ...block, a1: start + i, b1: start + j });
	}
	return blocks;
};

/**
 * Where text `after` differs from `before`: [{from, to, insert}], offsets in
 * `before`, ascending; lines first, then the words of the lines changed.
 */
const diffText = (before, after) => {
	if (before === after) return [];
	const a = before.split(/(?<=\n)/);
	const b = after.split(/(?<=\n)/);
	const blocks = diffLists(a, b) ?? [
		{ a0: 0, a1: a.length, b0: 0, b1: b.length },
	];
	const offsets = [0];
	for (const line of a) offsets.push(offsets[offsets.length - 1] + line.length);
	const hunks = [];
	for (const block of blocks) {
		const from = offsets[block.a0];
		const to = offsets[block.a1];
		const insert = b.slice(block.b0, block.b1).join('');
		if (to > from && insert) {
			for (const hunk of diffWords(before.slice(from, to), insert)) {
				hunks.push({
					from: from + hunk.from,
					to: from + hunk.to,
					insert: hunk.insert,
				});
			}
		} else {
			hunks.push({ from, to, insert });
		}
	}
	return hunks;
};

// Where text added at a clean offset goes among the tags there: after the
// comments and tracked changes that end there, before those that start.
const outsideTags = (view, offset) => {
	const before = view.rawEnd(offset);
	const after = view.rawStart(offset);
	let at = before;
	for (const match of view.matches) {
		if (match.closeTagStart >= before && match.closeTagEnd <= after) {
			at = Math.max(at, match.closeTagEnd);
		}
	}
	return at;
};

/**
 * The edits that make a document's text read `wanted`, keeping its comments
 * and tracked changes: [{at, remove, insert}] on the stored text, from its
 * end, so that each applies as it comes; null when it cannot.
 */
const editsFor = (stored, wanted) => {
	const view = cleanView(stored);
	if (view.text === wanted) return [];
	const edits = [];
	for (const hunk of diffText(view.text, wanted).reverse()) {
		const start = view.rawStart(hunk.from);
		const end = hunk.to > hunk.from ? view.rawEnd(hunk.to) : start;
		// The plain text between, without the tags, which stay.
		const cuts = [];
		let at = start;
		for (const range of view.ranges) {
			if (range.to <= at || range.from >= end) continue;
			if (range.from > at) cuts.push([at, range.from]);
			at = Math.max(at, range.to);
		}
		if (at < end) cuts.push([at, end]);
		for (const [from, to] of cuts.reverse()) {
			edits.push({ at: from, remove: to - from, insert: '' });
		}
		if (hunk.insert) {
			edits.push({
				at: hunk.to > hunk.from ? start : outsideTags(view, hunk.from),
				remove: 0,
				insert: hunk.insert,
			});
		}
	}
	let result = stored;
	for (const edit of edits) {
		result =
			result.slice(0, edit.at) + edit.insert + result.slice(edit.at + edit.remove);
	}
	return strip(result) === wanted ? edits : null;
};

const createGitBridge = ({
	dir,
	accounts,
	shares,
	files,
	history,
	log,
	maxFileBytes = 100 * 1024 * 1024,
}) => {
	const env = {
		PATH: process.env.PATH,
		HOME: os.tmpdir(),
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_TERMINAL_PROMPT: '0',
		LC_ALL: 'C',
	};

	// Runs git: {code, stdout, stderr}.
	const run = (args, { input, extraEnv } = {}) =>
		new Promise((resolve, reject) => {
			const child = spawn('git', args, { env: { ...env, ...extraEnv } });
			const out = [];
			const err = [];
			child.stdout.on('data', (chunk) => out.push(chunk));
			child.stderr.on('data', (chunk) => err.push(chunk));
			child.on('error', reject);
			child.on('close', (code) =>
				resolve({
					code,
					stdout: Buffer.concat(out),
					stderr: Buffer.concat(err).toString('utf8'),
				}),
			);
			child.stdin.on('error', () => {});
			child.stdin.end(input ?? null);
		});
	const git = async (repo, args, options) => {
		const result = await run(['--git-dir', repo, ...args], options);
		if (result.code !== 0) {
			throw new Error(`git ${args[0]}: ${result.stderr.trim()}`);
		}
		return result.stdout;
	};

	const repoOf = (project) => path.join(dir, `${project}.git`);

	// One change at a time to each project's repository.
	const locks = new Map();
	const withLock = (project, task) => {
		const previous = locks.get(project) ?? Promise.resolve();
		const next = previous.then(task, task);
		const settled = next.catch(() => {});
		locks.set(project, settled);
		settled.then(() => {
			if (locks.get(project) === settled) locks.delete(project);
		});
		return next;
	};

	const ensureRepo = async (project) => {
		const repo = repoOf(project);
		if (fs.existsSync(path.join(repo, 'HEAD'))) return repo;
		fs.mkdirSync(dir, { recursive: true });
		const temp = `${repo}.${process.pid}.${crypto.randomUUID()}.tmp`;
		const made = await run(['init', '--bare', '--quiet', temp]);
		if (made.code !== 0) throw new Error(`git init: ${made.stderr.trim()}`);
		await git(temp, ['symbolic-ref', 'HEAD', BRANCH]);
		await git(temp, ['config', 'core.logAllRefUpdates', 'false']);
		fs.renameSync(temp, repo);
		return repo;
	};

	const headOf = async (repo) => {
		const result = await run([
			'--git-dir',
			repo,
			'rev-parse',
			'--verify',
			'--quiet',
			`${BRANCH}^{commit}`,
		]);
		const head = result.stdout.toString('ascii').trim();
		return result.code === 0 && OID.test(head) ? head : null;
	};

	// The files of a commit: path -> {mode, id}.
	const treeOf = async (repo, commit) => {
		const tree = new Map();
		if (!commit) return tree;
		const out = await git(repo, ['ls-tree', '-r', '-z', '--full-tree', commit]);
		for (const record of out.toString('utf8').split('\0')) {
			const tab = record.indexOf('\t');
			if (tab < 0) continue;
			const [mode, type, id] = record.slice(0, tab).split(' ');
			if (type === 'blob') tree.set(record.slice(tab + 1), { mode, id });
		}
		return tree;
	};

	const metaPath = (repo) => path.join(repo, 'feuillet.json');
	const readMeta = (repo) => {
		try {
			return JSON.parse(fs.readFileSync(metaPath(repo), 'utf8'));
		} catch {
			return {};
		}
	};
	const writeMeta = (repo, meta) =>
		fs.writeFileSync(metaPath(repo), JSON.stringify(meta));

	/**
	 * The project's files as Git gets them: path -> {bytes, id, entry,
	 * document}, without the leading slash; and those whose contents the
	 * server does not have, which stay as the last commit has them.
	 */
	const stateOf = async (project) => {
		const state = new Map();
		const missing = new Set();
		for (const [filePath, entry] of await files.manifest(project)) {
			const name = filePath.slice(1);
			if (!validPath(name)) continue;
			const content = await files.read(project, entry);
			if (!content) {
				missing.add(name);
				continue;
			}
			let bytes = content.bytes;
			if (content.text !== undefined) {
				const plain = strip(content.text);
				bytes =
					!content.document && plain === content.text
						? (files.storedBytes(project, entry.checksum) ??
							Buffer.from(plain, 'utf8'))
						: Buffer.from(plain, 'utf8');
			}
			state.set(name, {
				bytes,
				id: blobId(bytes),
				entry,
				document: Boolean(content.document),
				unsaved: Boolean(content.unsaved),
			});
		}
		return { state, missing };
	};

	// Makes the project as it is now the last commit of master, when it
	// changed: its head.
	const sync = async (project) => {
		const repo = await ensureRepo(project);
		const head = await headOf(repo);
		const tree = await treeOf(repo, head);
		const { state, missing } = await stateOf(project);
		const put = [...state].filter(([name, file]) => tree.get(name)?.id !== file.id);
		const drop = [...tree.keys()].filter(
			(name) => !state.has(name) && !missing.has(name),
		);
		if (put.length === 0 && drop.length === 0) return head;

		const meta = readMeta(repo);
		const authors = [
			...new Set(
				history
					.list(project)
					.filter((version) => version.time > (meta.syncedAt ?? 0))
					.flatMap((version) => version.authors ?? [])
					.filter((name) => typeof name === 'string' && !PUSHED_BY.test(name))
					.map(cleanName),
			),
		];
		const now = Math.floor(Date.now() / 1000);
		const message = Buffer.from(
			`Update from Feuillet\n${authors.length ? `\nChanged by ${authors.join(', ')}.\n` : ''}`,
			'utf8',
		);
		const author = authors.length === 1 ? authors[0] : 'Feuillet';
		const parts = [
			`commit ${BRANCH}\n`,
			`author ${author} <> ${now} +0000\n`,
			`committer Feuillet <> ${now} +0000\n`,
			`data ${message.length}\n`,
			message,
			'\n',
			...(head ? [`from ${head}\n`] : []),
		];
		for (const [name, file] of put) {
			const mode = tree.get(name)?.mode === '100755' ? '100755' : '100644';
			parts.push(
				`M ${mode} inline ${quotePath(name)}\n`,
				`data ${file.bytes.length}\n`,
				file.bytes,
				'\n',
			);
		}
		for (const name of drop) parts.push(`D ${quotePath(name)}\n`);
		parts.push('\n');
		await git(repo, ['fast-import', '--quiet', '--date-format=raw'], {
			input: Buffer.concat(
				parts.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part))),
			),
		});
		writeMeta(repo, { ...meta, syncedAt: Date.now() });
		await run(['--git-dir', repo, 'gc', '--auto', '--quiet']);
		return headOf(repo);
	};

	// ---- Signing in, and the project

	const send = (res, status, message, headers = {}) => {
		res.writeHead(status, {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-cache',
			...headers,
		});
		res.end(`${message}\n`);
	};

	const SIGN_IN =
		"Feuillet asks for your account's name and a Git token, which you make in Feuillet under Profile Settings, Git; your password does not work here.";
	// What Git gave as the password is no Git token: most likely the
	// account's password, since Git asks for "Password".
	const NOT_A_TOKEN =
		'This is not a Git token. When Git asks for a password, give a Git token, which starts with fgt_, not your Feuillet password: make one in Feuillet under Profile Settings, Git.';

	// The account Git signed in as, or null once it was told why not.
	const signIn = async (req, res) => {
		const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(
			req.headers.authorization ?? '',
		);
		const decoded = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
		const colon = decoded.indexOf(':');
		if (colon < 0) {
			send(res, 401, SIGN_IN, {
				'WWW-Authenticate': 'Basic realm="Feuillet", charset="UTF-8"',
			});
			return null;
		}
		try {
			return await accounts.verifyGitToken(
				decoded.slice(0, colon),
				decoded.slice(colon + 1),
				accounts.clientAddress(req),
			);
		} catch (error) {
			if (error?.status === 429) {
				send(
					res,
					429,
					'Too many wrong Git tokens: try again in a quarter of an hour.',
				);
			} else {
				const message =
					error?.code === 'not_a_token'
						? NOT_A_TOKEN
						: `Wrong account name or Git token. ${SIGN_IN}`;
				send(res, 401, message, {
					'WWW-Authenticate': 'Basic realm="Feuillet", charset="UTF-8"',
				});
			}
			return null;
		}
	};

	// The request's body, unzipped, up to `max` bytes.
	const readBody = (req, max) =>
		new Promise((resolve, reject) => {
			const encoding = String(req.headers['content-encoding'] ?? '').trim();
			const source =
				encoding === 'gzip' || encoding === 'x-gzip'
					? req.pipe(zlib.createGunzip())
					: req;
			const chunks = [];
			let size = 0;
			source.on('data', (chunk) => {
				size += chunk.length;
				if (size > max) {
					reject(new HttpError(413, 'This push is too large.'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			source.on('end', () => resolve(Buffer.concat(chunks)));
			source.on('error', () =>
				reject(new HttpError(400, 'The request could not be read.')),
			);
		});

	// ---- Clones and pulls

	const protocolEnv = (req) => {
		const protocol = String(req.headers['git-protocol'] ?? '');
		return /^[A-Za-z0-9=:.,_-]{1,100}$/.test(protocol)
			? { GIT_PROTOCOL: protocol }
			: {};
	};

	const advertiseFetch = async (req, res, project) => {
		await withLock(project, () => sync(project));
		const extraEnv = protocolEnv(req);
		const result = await run(
			['upload-pack', '--stateless-rpc', '--advertise-refs', repoOf(project)],
			{ extraEnv },
		);
		if (result.code !== 0) throw new Error(`git upload-pack: ${result.stderr}`);
		res.writeHead(200, {
			'Content-Type': 'application/x-git-upload-pack-advertisement',
			'Cache-Control': 'no-cache',
		});
		// Protocol version 2 starts without the service line.
		if (!/version=2/.test(extraEnv.GIT_PROTOCOL ?? '')) {
			res.write(pkt('# service=git-upload-pack\n'));
			res.write(FLUSH);
		}
		res.end(result.stdout);
	};

	const uploadPack = async (req, res, project) => {
		const body = await readBody(req, MAX_FETCH_BYTES);
		await withLock(project, () => ensureRepo(project));
		const result = await run(
			['upload-pack', '--stateless-rpc', repoOf(project)],
			{ input: body, extraEnv: protocolEnv(req) },
		);
		if (result.code !== 0 && result.stdout.length === 0) {
			throw new Error(`git upload-pack: ${result.stderr}`);
		}
		res.writeHead(200, {
			'Content-Type': 'application/x-git-upload-pack-result',
			'Cache-Control': 'no-cache',
		});
		res.end(result.stdout);
	};

	// ---- Pushes

	const advertisePush = async (res, project) => {
		const head = await withLock(project, () => sync(project));
		res.writeHead(200, {
			'Content-Type': 'application/x-git-receive-pack-advertisement',
			'Cache-Control': 'no-cache',
		});
		res.write(pkt('# service=git-receive-pack\n'));
		res.write(FLUSH);
		res.write(
			pkt(
				head
					? `${head} ${BRANCH}\0${CAPABILITIES}\n`
					: `${ZERO} capabilities^{}\0${CAPABILITIES}\n`,
			),
		);
		res.end(FLUSH);
	};

	// What a pushed commit changes from `base`: [{name, status, mode, id}].
	const changesOf = async (repo, base, commit) => {
		const changes = [];
		if (!base) {
			for (const [name, { mode, id }] of await treeOf(repo, commit)) {
				changes.push({ name, status: 'A', mode, id });
			}
			return changes;
		}
		const out = await git(repo, [
			'diff-tree',
			'-r',
			'-z',
			'--no-renames',
			'--raw',
			base,
			commit,
		]);
		const fields = out.toString('utf8').split('\0');
		for (let i = 0; i + 1 < fields.length; i += 2) {
			const [, mode, , id, status] = fields[i].split(' ');
			changes.push({ name: fields[i + 1], status: status[0], mode, id });
		}
		return changes;
	};

	// The contents of these blobs, by id.
	const blobsOf = async (repo, ids) => {
		const blobs = new Map();
		if (ids.length === 0) return blobs;
		const out = await git(repo, ['cat-file', '--batch'], {
			input: `${ids.join('\n')}\n`,
		});
		let at = 0;
		while (at < out.length) {
			const lineEnd = out.indexOf(10, at);
			const [id, type, size] = out.toString('ascii', at, lineEnd).split(' ');
			const length = Number(size);
			if (type !== 'blob' || !Number.isInteger(length)) {
				throw new Refusal(`object ${id} is missing`);
			}
			blobs.set(id, out.subarray(lineEnd + 1, lineEnd + 1 + length));
			at = lineEnd + 1 + length + 1;
		}
		return blobs;
	};

	const sizesOf = async (repo, ids) => {
		const sizes = new Map();
		if (ids.length === 0) return sizes;
		const out = await git(repo, ['cat-file', '--batch-check'], {
			input: `${ids.join('\n')}\n`,
		});
		for (const line of out.toString('ascii').split('\n')) {
			const [id, type, size] = line.split(' ');
			if (type === 'blob') sizes.set(id, Number(size));
		}
		return sizes;
	};

	// Makes the project what the pushed commit holds, from `base`, which is
	// what the project is now; what it changed.
	const applyPush = async (project, repo, base, commit, username) => {
		const changes = await changesOf(repo, base, commit);
		const author = `Git (${username})`;
		const sizes = await sizesOf(
			repo,
			changes.filter((change) => change.status !== 'D').map((change) => change.id),
		);
		for (const change of changes) {
			if (!validPath(change.name) || !portablePath(change.name)) {
				throw new Refusal(`Feuillet does not accept the path ${change.name}`);
			}
			if (change.status === 'D') continue;
			if (change.mode === '120000') {
				throw new Refusal(`${change.name} is a symbolic link, which Feuillet does not keep`);
			}
			if (change.mode === '160000') {
				throw new Refusal(`${change.name} is a submodule, which Feuillet does not keep`);
			}
			if ((sizes.get(change.id) ?? 0) > maxFileBytes) {
				throw new Refusal(`${change.name} is larger than Feuillet accepts`);
			}
		}
		const blobs = await blobsOf(
			repo,
			changes.filter((change) => change.status !== 'D').map((change) => change.id),
		);

		// Everything is checked before anything changes.
		const { state } = await stateOf(project);
		const manifest = await files.manifest(project);
		const plan = [];
		for (const change of changes) {
			const current = state.get(change.name);
			if (change.status === 'D') {
				if (manifest.has(`/${change.name}`)) plan.push({ kind: 'delete', change });
				continue;
			}
			const bytes = blobs.get(change.id);
			if (current?.unsaved) {
				throw new Refusal(
					`${change.name} is open in an editor that has not sent its text to the server yet: open the project in Feuillet, then pull and push again`,
				);
			}
			if (current?.document) {
				const text = textOf(bytes);
				if (text === null) {
					throw new Refusal(
						`${change.name} is a document in Feuillet: it must stay UTF-8 text, of 5 MB at most`,
					);
				}
				const { text: stored } = await files.read(project, current.entry);
				const edits = editsFor(stored, text);
				if (!edits) throw new Refusal(`the changes to ${change.name} could not be made`);
				plan.push({ kind: 'document', change, entry: current.entry, text });
			} else {
				plan.push({ kind: 'file', change, bytes });
			}
		}

		let changedFiles = false;
		for (const step of plan) {
			const filePath = `/${step.change.name}`;
			if (step.kind === 'delete') {
				await files.removeFile(project, filePath, author);
				changedFiles = true;
			} else if (step.kind === 'file') {
				await files.writeBytes(project, filePath, step.bytes, author);
				changedFiles = true;
			} else {
				await files.changeDocument(project, step.entry.documentId, (ytext) => {
					// Its text as it is at this moment.
					const edits = editsFor(ytext.toString(), step.text) ?? [];
					for (const edit of edits) {
						if (edit.remove) ytext.delete(edit.at, edit.remove);
						if (edit.insert) ytext.insert(edit.at, edit.insert);
					}
				});
				history.record(project, `yjs_${step.entry.documentId}`, [author]);
			}
		}
		if (changedFiles) history.record(project, 'file_sync', [author]);
		return plan.length;
	};

	const receivePack = async (req, res, project, caller) => {
		const body = await readBody(req, MAX_PUSH_BYTES);
		const { lines, rest } = readPackets(body);
		const commands = [];
		let capabilities = new Set();
		for (const line of lines) {
			let text = line.toString('latin1').replace(/\n$/, '');
			const nul = text.indexOf('\0');
			if (nul >= 0) {
				capabilities = new Set(text.slice(nul + 1).split(' '));
				text = text.slice(0, nul);
			}
			if (text.startsWith('shallow ')) continue;
			const command = /^([0-9a-f]{40}) ([0-9a-f]{40}) (\S+)$/.exec(text);
			if (!command) throw new HttpError(400, 'This is not a Git push.');
			commands.push({ old: command[1], new: command[2], ref: command[3] });
		}

		const results = [];
		const messages = [];
		let unpack = 'ok';
		await withLock(project, async () => {
			const head = await sync(project);
			const repo = repoOf(project);
			if (rest.length > 0) {
				const unpacked = await run(
					['--git-dir', repo, 'index-pack', '--stdin', '--fix-thin', '--strict'],
					{ input: rest },
				);
				if (unpacked.code !== 0) {
					unpack = 'index-pack failed';
					log('git push could not be read:', unpacked.stderr.trim().slice(0, 300));
				}
			}
			for (const command of commands) {
				const refuse = (reason) => results.push({ ref: command.ref, reason });
				if (unpack !== 'ok') {
					refuse('unpacker error');
					continue;
				}
				if (command.ref !== BRANCH) {
					refuse('Feuillet keeps only the master branch');
					continue;
				}
				if (command.new === ZERO) {
					refuse('master cannot be deleted');
					continue;
				}
				const old = command.old === ZERO ? null : command.old;
				if (old !== head) {
					refuse(
						head && old
							? 'the project changed in Feuillet: git pull, then push again'
							: 'fetch first: git pull, then push again',
					);
					continue;
				}
				if (command.new === head) {
					results.push({ ref: command.ref });
					continue;
				}
				try {
					const type = await run(['--git-dir', repo, 'cat-file', '-t', command.new]);
					if (type.stdout.toString().trim() !== 'commit') {
						throw new Refusal('this is not a commit');
					}
					if (head) {
						const ancestor = await run([
							'--git-dir',
							repo,
							'merge-base',
							'--is-ancestor',
							head,
							command.new,
						]);
						if (ancestor.code !== 0) {
							throw new Refusal(
								'not a fast-forward: git pull, then push again (Feuillet takes no forced push)',
							);
						}
					}
					const count = await applyPush(project, repo, head, command.new, caller.username);
					await git(repo, ['update-ref', BRANCH, command.new, head ?? ZERO]);
					writeMeta(repo, { ...readMeta(repo), syncedAt: Date.now() });
					messages.push(
						count === 1
							? 'Feuillet: 1 file changed in the project.'
							: `Feuillet: ${count} files changed in the project.`,
					);
					log('git push:', count, 'files changed');
					results.push({ ref: command.ref });
				} catch (error) {
					if (!(error instanceof Refusal)) {
						log('git push failed', error);
						refuse('Feuillet could not take this push');
					} else {
						refuse(error.message);
					}
				}
			}
			await run(['--git-dir', repo, 'gc', '--auto', '--quiet']);
		});

		const report = Buffer.concat([
			pkt(`unpack ${unpack}\n`),
			...results.map((result) =>
				pkt(
					result.reason
						? `ng ${result.ref} ${result.reason}\n`
						: `ok ${result.ref}\n`,
				),
			),
			FLUSH,
		]);
		res.writeHead(200, {
			'Content-Type': 'application/x-git-receive-pack-result',
			'Cache-Control': 'no-cache',
		});
		if (!capabilities.has('side-band-64k')) {
			res.end(report);
			return;
		}
		const band = (n, data) => pkt(Buffer.concat([Buffer.from([n]), data]));
		res.end(
			Buffer.concat([
				...messages.map((message) => band(2, Buffer.from(`${message}\n`))),
				band(1, report),
				FLUSH,
			]),
		);
	};

	// ---- Routes

	const handles = (url) => url.startsWith('/git/');

	const handle = async (req, res, url) => {
		try {
			// Git sends no Origin; a page in a browser would.
			if (req.headers.origin) throw new HttpError(403, 'Git only.');
			const match = ROUTE.exec(url);
			if (!match) throw new HttpError(404, 'Not found.');
			const [, id, action] = match;
			const service =
				action === 'info/refs'
					? new URL(req.url, 'http://localhost').searchParams.get('service')
					: action;
			if (!SERVICES.includes(service)) {
				throw new HttpError(
					403,
					'Feuillet speaks only the smart HTTP protocol of Git 1.7 or later.',
				);
			}
			if (req.method !== (action === 'info/refs' ? 'GET' : 'POST')) {
				throw new HttpError(405, 'Method not allowed.');
			}
			const caller = await signIn(req, res);
			if (!caller) {
				req.resume();
				return;
			}
			const found = shares.accessOf(caller.id, id);
			if (!found?.role) {
				throw new HttpError(
					404,
					'This account has no project at this address: Git works for its owner and the collaborators invited by name.',
				);
			}
			const pushes = service === 'git-receive-pack';
			if (pushes && found.role !== 'owner' && found.role !== 'editor') {
				throw new HttpError(
					403,
					'Your role in this project lets you clone and pull it, not push to it.',
				);
			}
			if (action === 'info/refs') {
				req.resume();
				if (pushes) await advertisePush(res, found.project);
				else await advertiseFetch(req, res, found.project);
			} else if (pushes) {
				await receivePack(req, res, found.project, caller);
			} else {
				await uploadPack(req, res, found.project);
			}
		} catch (error) {
			req.resume();
			if (res.headersSent) {
				res.destroy();
				return;
			}
			if (error instanceof HttpError) {
				send(res, error.status, error.message);
				return;
			}
			log('git request failed', error);
			send(res, 500, 'Feuillet could not answer Git. Please try again later.');
		}
	};

	// A project deleted for good: its repository goes too.
	const erase = (project) =>
		withLock(project, () =>
			fs.rmSync(repoOf(project), { recursive: true, force: true }),
		);

	return { handles, handle, erase };
};

module.exports = { createGitBridge, diffText, diffLists, editsFor, blobId };
