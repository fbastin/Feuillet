/**
 * @jest-environment node
 */
// Markdown with Pandoc on the TeX Live server (server/texlive/server.js), as
// Overleaf's export and import: a project's LaTeX, its included files and
// its citations, to GitHub Markdown; a Markdown file to a LaTeX document.
// The real server, run here, with this machine's Pandoc; skipped without,
// or without the server's own packages (npm install in server/texlive),
// as in the continuous integration, which installs only the application's.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const SERVER = path.join(__dirname, '../../../server/texlive');
const SERVER_WS = path.join(SERVER, 'node_modules/ws');

const hasPandoc = (() => {
	try {
		execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();
const hasServer = fs.existsSync(path.join(SERVER_WS, 'package.json'));
const maybe = hasPandoc && hasServer ? describe : describe.skip;
const WebSocket = hasServer ? require(SERVER_WS) : null;

const freePort = () =>
	new Promise<number>((resolve) => {
		const probe = net.createServer();
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as net.AddressInfo;
			probe.close(() => resolve(port));
		});
	});

const file = (filePath: string, text: string) => ({
	path: filePath,
	content: Buffer.from(text, 'utf8').toString('base64'),
});

const PROJECT = [
	file(
		'main.tex',
		String.raw`\documentclass{article}
\usepackage[english,french]{babel}
\usepackage{graphicx}
\usepackage{biblatex}
\addbibresource{refs.bib}
\begin{document}
\section{Introduction}
Comme le montre \textcite{knuth}, l'équation $e^{i\pi} + 1 = 0$ est belle.
\include{chapters/two}
\printbibliography
\end{document}
`,
	),
	file(
		'chapters/two.tex',
		String.raw`\section{Résultats}
\begin{figure}
  \includegraphics{images/plot.png}
  \caption{Une courbe.}
\end{figure}
\begin{tabular}{lr}
Essai & Valeur \\
1 & 0,5 \\
\end{tabular}
`,
	),
	file(
		'refs.bib',
		'@book{knuth, author = {Donald E. Knuth}, title = {The TeXbook}, publisher = {Addison-Wesley}, year = {1984}}\n',
	),
];

maybe('Pandoc on the TeX Live server', () => {
	let server: ChildProcess;
	let url: string;
	let work: string;

	beforeAll(async () => {
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'feuillet-pandoc-'));
		const port = await freePort();
		server = spawn(process.execPath, ['server.js'], {
			cwd: SERVER,
			env: {
				...process.env,
				HOST: '127.0.0.1',
				PORT: String(port),
				WORK_DIR: path.join(work, 'work'),
				TEXLIVE_YEAR: '2026',
				ALLOWED_ORIGINS: '',
				COMPILE_TICKET_PUBLIC_KEY: '',
			},
			stdio: 'ignore',
		});
		url = `ws://127.0.0.1:${port}/`;
		const end = Date.now() + 15_000;
		while (Date.now() < end) {
			const ok = await fetch(`http://127.0.0.1:${port}/health`)
				.then((response) => response.ok)
				.catch(() => false);
			if (ok) return;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error('The TeX Live server did not start');
	}, 20_000);

	afterAll(() => {
		server?.kill();
		fs.rmSync(work, { recursive: true, force: true });
	});

	const ask = (request: Record<string, unknown>) =>
		new Promise<Record<string, any>>((resolve, reject) => {
			const socket = new WebSocket(url, ['feuillet']);
			socket.on('open', () =>
				socket.send(JSON.stringify({ requestId: 'r1', ...request })),
			);
			socket.on('message', (data: Buffer) => {
				resolve(JSON.parse(data.toString('utf8')));
				socket.close();
			});
			socket.on('error', reject);
		});
	const text = (reply: Record<string, any>) =>
		Buffer.from(reply.output ?? '', 'base64').toString('utf8');

	it('converts a project to GitHub Markdown, its parts and citations included', async () => {
		const reply = await ask({
			mainFile: 'main.tex',
			format: 'markdown',
			files: PROJECT,
			options: { action: 'pandoc', to: 'markdown', lang: 'fr' },
		});
		expect(reply.status).toBe(0);
		expect(reply.mimeType).toBe('text/markdown');
		const markdown = text(reply);
		expect(markdown).toContain('# Introduction');
		// The included file.
		expect(markdown).toContain('# Résultats');
		expect(markdown).toContain('![');
		expect(markdown).toContain('images/plot.png');
		expect(markdown).toMatch(/\| Essai +\| Valeur \|/);
		// Math as GitHub writes it, citations from the bibliography, in French.
		expect(markdown).toContain('$e^{i\\pi} + 1 = 0$');
		expect(markdown).toContain('Knuth (1984)');
		expect(markdown).toContain('# Références');
		expect(markdown).toContain('*The TeXbook*');
		// No HTML for what Markdown cannot say.
		expect(markdown).not.toMatch(/<(div|figure|img|a)\b/);
	}, 60_000);

	it('keeps the citations as keys when the bibliography is missing', async () => {
		const reply = await ask({
			mainFile: 'main.tex',
			format: 'markdown',
			files: PROJECT.filter((entry) => entry.path !== 'refs.bib'),
			options: { action: 'pandoc', to: 'markdown' },
		});
		expect(reply.status).toBe(0);
		expect(text(reply)).toContain('# Introduction');
	}, 60_000);

	it('converts a Markdown file to a LaTeX document, in its language', async () => {
		const reply = await ask({
			mainFile: 'notes.md',
			format: 'latex',
			files: [
				file(
					'notes.md',
					'---\ntitle: Mes notes\n---\n\n# Partie\n\nUn *texte* et $x^2$, voir https://example.org.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
				),
			],
			options: { action: 'pandoc', to: 'latex', lang: 'fr' },
		});
		expect(reply.status).toBe(0);
		const latex = text(reply);
		expect(latex).toMatch(/\\documentclass\{article\}/);
		expect(latex).toContain('\\title{Mes notes}');
		expect(latex).toMatch(/\\section\{Partie\}/);
		expect(latex).toContain('\\emph{texte}');
		expect(latex).toContain('\\(x^2\\)');
		expect(latex).toContain('\\url{https://example.org}');
		expect(latex).toMatch(/french/);
		expect(latex).toContain('\\end{document}');
	}, 60_000);

	it('says why it cannot convert', async () => {
		const missing = await ask({
			mainFile: 'absent.tex',
			format: 'markdown',
			files: PROJECT,
			options: { action: 'pandoc', to: 'markdown' },
		});
		expect(missing.status).toBe(1);
		expect(missing.log).toContain('Main file not found');
		const outside = await ask({
			mainFile: '../etc/passwd',
			format: 'markdown',
			files: PROJECT,
			options: { action: 'pandoc', to: 'markdown' },
		});
		expect(outside.status).toBe(1);
	}, 60_000);
});
