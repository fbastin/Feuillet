// server/collab/compile.js
// Compiles a project with the TeX Live server (server/texlive), for the
// assistants that work on projects through mcp.js: the project's files go
// in one request, as Feuillet's editor sends them, and what comes back is
// the outcome and the log, summed up.
//
// Environment (read by server.js):
//   TEXLIVE_URL     the TeX Live server's WebSocket address, e.g.
//                   ws://texlive:7045; unset turns compiling off
//   TEXLIVE_ORIGIN  the Origin to present, one the TeX Live server allows

const crypto = require('node:crypto');
const WebSocket = require('ws');

const ENGINES = ['pdflatex', 'xelatex', 'lualatex'];

const createCompiler = ({ url, origin, timeoutMs = 240_000 }) => {
	if (!url) return null;

	/** {status, log, pdf?}: status 0 for a PDF without errors. */
	const compile = ({ files, mainFile, engine }) =>
		new Promise((resolve, reject) => {
			const requestId = crypto.randomUUID();
			const socket = new WebSocket(url, {
				headers: origin ? { Origin: origin } : {},
				maxPayload: 512 * 1024 * 1024,
			});
			let settled = false;
			const finish = (error, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.close();
				if (error) reject(error);
				else resolve(value);
			};
			const timer = setTimeout(
				() => finish(new Error('The compile took too long.')),
				timeoutMs,
			);
			socket.on('open', () => {
				socket.send(
					JSON.stringify({
						requestId,
						mainFile: mainFile.replace(/^\/+/, ''),
						format: 'pdf',
						files: files.map((file) => ({
							path: file.path.replace(/^\/+/, ''),
							content: file.bytes.toString('base64'),
						})),
						options: { engine: ENGINES.includes(engine) ? engine : 'pdflatex' },
					}),
				);
			});
			socket.on('message', (data) => {
				let reply;
				try {
					reply = JSON.parse(data.toString('utf8'));
				} catch {
					return;
				}
				if (reply?.requestId !== requestId) return;
				finish(null, {
					status: Number(reply.status ?? 1),
					log: String(reply.log ?? ''),
					pdf: typeof reply.output === 'string' ? reply.output : null,
				});
			});
			socket.on('error', (error) =>
				finish(new Error(`The TeX Live server cannot be reached (${error.message}).`)),
			);
			socket.on('close', () =>
				finish(new Error('The TeX Live server closed the connection.')),
			);
		});

	return { compile };
};

/**
 * The errors and warnings of a LaTeX log, as {errors: [{message, line,
 * file, context}], warnings: [...], pages}.
 */
const summarizeLog = (log) => {
	const lines = log.split('\n');
	// The file being read, from the parentheses TeX writes as it opens and
	// closes files: every parenthesis counts, so that those of messages
	// close themselves. Approximate, as in every log viewer.
	const fileAt = [];
	let opened = [];
	for (const line of lines) {
		if (/^\*\*|^This is (?:pdf|Xe|Lua(?:HB)?)?TeX/.test(line)) opened = [];
		for (const match of line.matchAll(/\(([^\s()]*)|\)/g)) {
			if (match[0] === ')') opened.pop();
			else opened.push(match[1]);
		}
		fileAt.push(
			[...opened]
				.reverse()
				.find((name) => /^\.?\/?[^\s]+\.(?:tex|ltx|bbl)$/.test(name) && !name.startsWith('/usr/')) ??
				null,
		);
	}
	const clean = (file) => (file ? `/${file.replace(/^\.?\/+/, '')}` : null);

	const errors = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fileLine = /^(\.?\/?[^\s:]+\.tex):(\d+): (.*)$/.exec(line);
		if (line.startsWith('! ') || fileLine) {
			let lineNumber = fileLine ? Number(fileLine[2]) : null;
			const context = [];
			for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
				const at = /^l\.(\d+)\s?(.*)$/.exec(lines[j]);
				context.push(lines[j]);
				if (at) {
					lineNumber ??= Number(at[1]);
					break;
				}
			}
			errors.push({
				message: (fileLine ? fileLine[3] : line.slice(2)).trim(),
				file: fileLine ? clean(fileLine[1]) : clean(fileAt[i]),
				line: lineNumber,
				context: context.join('\n').trim().slice(0, 400),
			});
		}
	}

	const warnings = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (
			/(?:LaTeX|Package [\w-]+|Class [\w-]+) Warning:/.test(line) ||
			/^(Overfull|Underfull) \\[hv]box/.test(line)
		) {
			let message = line;
			for (let j = i + 1; j < lines.length && /^\(\S+\)\s/.test(lines[j]); j++) {
				message += ` ${lines[j].replace(/^\(\S+\)\s+/, '')}`;
			}
			const at = /on input line (\d+)|at lines? (\d+)/.exec(message);
			warnings.push({
				message: message.replace(/\s+/g, ' ').trim().slice(0, 300),
				file: clean(fileAt[i]),
				line: at ? Number(at[1] ?? at[2]) : null,
			});
		}
	}

	const pages = /Output written on \S+ \((\d+) pages?/.exec(log);
	// The same error repeats on each pass.
	const unique = (list) => {
		const seen = new Set();
		return list.filter((entry) => {
			const key = `${entry.file}:${entry.line}:${entry.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	};
	return {
		errors: unique(errors),
		warnings: unique(warnings),
		pages: pages ? Number(pages[1]) : null,
	};
};

module.exports = { createCompiler, summarizeLog, ENGINES };
