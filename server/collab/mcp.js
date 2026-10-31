// server/collab/mcp.js
// Lets an assistant such as Claude work on Feuillet projects, through the
// Model Context Protocol: Claude (claude.ai, Claude Desktop) adds this server
// as a custom connector, Claude Code with
//   claude mcp add --transport http feuillet https://<host>/collab/mcp
// and both then work under the account that signed in (oauth.js), with its
// role in each project.
//
//   POST /mcp   JSON-RPC (Streamable HTTP, answered with JSON): initialize,
//               ping, tools/list, tools/call
//
// What the assistant changes goes to the documents collaborators have open,
// so that they see it at once, as tracked changes by default: they accept or
// reject them in Feuillet's review panel, as Overleaf's suggestions. Readers
// only read; reviewers suggest and comment; editors may also change files
// directly and create files. Changes are saved in the project's history
// under the assistant's and the account's names.

const { strip, cleanView, annotationsOf, commentTags, reviewTags, scanAll, tagUser, withResponse } =
	require('./annotations');
const { summarizeLog, ENGINES } = require('./compile');

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_READ_CHARS = 80_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_COMPILE_BYTES = 90 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(
	'tex latex ltx sty cls bib bst bbx cbx lbx dtx ins def cfg clo fd txt md markdown typ csv tsv json yaml yml xml svg lua py r rmd jl m tikz pgf asy gp dat log bbl gitignore latexmkrc'.split(
		' ',
	),
);

class ToolError extends Error {}

const extensionOf = (filePath) =>
	(/\.([^./]+)$/.exec(filePath)?.[1] ?? filePath.split('/').pop() ?? '').toLowerCase();
const isTextPath = (filePath) => TEXT_EXTENSIONS.has(extensionOf(filePath));

const sizeText = (bytes) =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${(bytes / 1024).toFixed(1)} kB`
			: `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const dateText = (time) =>
	Number.isFinite(time) && time > 0 ? new Date(time).toISOString().slice(0, 10) : '';
const quote = (text, max = 160) => {
	const flat = String(text).replace(/\s+/g, ' ').trim();
	return `“${flat.length > max ? `${flat.slice(0, max)}…` : flat}”`;
};

const normalizePath = (value) => {
	const raw = String(value ?? '').trim().replaceAll('\\', '/');
	if (!raw) throw new ToolError('A path is required, such as /main.tex.');
	const parts = raw.split('/').filter((part) => part && part !== '.');
	if (parts.includes('..')) throw new ToolError('Paths may not contain "..".');
	return `/${parts.join('/')}`;
};

// Words, runs of spaces and single other characters: a change shows as the
// words it changes, not as letters.
const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/**
 * Where `after` differs from `before`: [{from, to, insert}], offsets in
 * `before`, word by word, changes separated only by spaces kept together.
 */
const diffWords = (before, after) => {
	const a = before.match(TOKEN) ?? [];
	const b = after.match(TOKEN) ?? [];
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const offsets = [0];
	for (const token of a) offsets.push(offsets[offsets.length - 1] + token.length);
	const n = endA - start;
	const m = endB - start;
	// Common words in the middle, when the tables stay small.
	const pairs = [];
	if (n > 0 && m > 0 && n * m <= 4_000_000) {
		const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
		for (let i = n - 1; i >= 0; i--) {
			for (let j = m - 1; j >= 0; j--) {
				table[i][j] =
					a[start + i] === b[start + j]
						? table[i + 1][j + 1] + 1
						: Math.max(table[i + 1][j], table[i][j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < n && j < m) {
			if (a[start + i] === b[start + j]) {
				pairs.push([start + i, start + j]);
				i++;
				j++;
			} else if (table[i + 1][j] >= table[i][j + 1]) i++;
			else j++;
		}
	}
	pairs.push([endA, endB]);
	const hunks = [];
	let i = start;
	let j = start;
	for (const [pi, pj] of pairs) {
		if (pi > i || pj > j) {
			hunks.push({
				from: offsets[i],
				to: offsets[pi],
				insert: b.slice(j, pj).join(''),
			});
		}
		i = pi + 1;
		j = pj + 1;
	}
	// Changes separated only by spaces, or by one short word, read better as one.
	const merged = [];
	for (const hunk of hunks) {
		const last = merged[merged.length - 1];
		const gap = last ? before.slice(last.to, hunk.from) : null;
		if (last && gap !== null && (/^\s*$/.test(gap) || /^\s*[\p{L}\p{N}_]{1,3}\s*$/u.test(gap))) {
			last.insert += gap + hunk.insert;
			last.to = hunk.to;
		} else {
			merged.push({ from: hunk.from, to: hunk.to, insert: hunk.insert });
		}
	}
	return merged;
};

// Text an assistant writes may not hold the tags of comments and tracked
// changes, which would pass for someone else's.
const refuseTags = (text, what) => {
	if (/<\/?#{3,4}/.test(text)) {
		throw new ToolError(`${what} may not contain Feuillet's comment or suggestion tags.`);
	}
};

const occurrences = (text, part) => {
	const found = [];
	let at = text.indexOf(part);
	while (at !== -1) {
		found.push(at);
		at = text.indexOf(part, at + 1);
	}
	return found;
};

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

/** The one place of `part` in `text`, or a helpful error. */
const locate = (text, part, what) => {
	if (!part) throw new ToolError(`${what} must not be empty.`);
	const found = occurrences(text, part);
	if (found.length === 1) return found[0];
	if (found.length > 1) {
		throw new ToolError(
			`${what} appears ${found.length} times (lines ${found
				.slice(0, 10)
				.map((at) => lineOf(text, at))
				.join(', ')}). Include more of the surrounding text so that it appears once.`,
		);
	}
	const loose = (value) => value.replace(/\s+/g, ' ').trim();
	const hint = loose(text).includes(loose(part))
		? ' It appears with different spaces or line breaks: copy it exactly as read_file shows it, without the line numbers.'
		: ' Read the file again: it may have changed.';
	throw new ToolError(`${what} was not found in the file.${hint}`);
};

const createMcp = ({ oauth, shares, files, history, compiler, log, version = '1.0.0' }) => {
	// ---- Projects and access

	const linkIds = (entry) =>
		[
			entry.editId,
			/^yjs:([A-Za-z0-9_-]+)/.exec(String(entry.docUrl ?? ''))?.[1],
			entry.id,
		].filter((id, index, all) => id && all.indexOf(id) === index);

	const projectsOf = (account) =>
		account.projects
			.filter((entry) => !entry.trashedAt)
			.map((entry) => {
				for (const id of linkIds(entry)) {
					const access = shares.accessOf(account.id, id);
					if (access) return { entry, ...access };
				}
				return null;
			})
			.filter(Boolean);

	const findProject = (account, ref) => {
		const wanted = String(ref ?? '').trim();
		if (!wanted) throw new ToolError('A project is required: its id from list_projects.');
		const projects = projectsOf(account);
		const byId = projects.find((project) => project.entry.id === wanted);
		if (byId) return byId;
		const byName = projects.filter(
			(project) => project.entry.name.trim().toLowerCase() === wanted.toLowerCase(),
		);
		if (byName.length === 1) return byName[0];
		throw new ToolError(
			byName.length > 1
				? `Several projects are named ${quote(wanted)}: use the id from list_projects.`
				: `No project ${quote(wanted)} among this account's projects. Use list_projects.`,
		);
	};

	const ACCESS_TEXT = {
		edit: 'can edit',
		review: 'can comment and suggest changes',
		view: 'can read only',
	};

	const authorOf = (context) => tagUser(`${context.clientName} (${context.username})`);

	// Whether this account's changes in the project must be suggestions.
	const tracked = (metadata, username) => {
		const setting = metadata.trackChanges;
		return Boolean(
			setting && (setting.everyone === true || (setting.users ?? []).includes(username)),
		);
	};

	const mainFileOf = async (project, metadata, manifest) => {
		if (typeof metadata.mainFile === 'string' && manifest.has(metadata.mainFile)) {
			return metadata.mainFile;
		}
		if (manifest.has('/main.tex')) return '/main.tex';
		for (const [filePath, entry] of manifest) {
			if (!filePath.endsWith('.tex')) continue;
			const content = await files.read(project, entry);
			if (content?.text && /\\documentclass/.test(strip(content.text))) return filePath;
		}
		return null;
	};

	const fileOf = async (project, filePath) => {
		const manifest = await files.manifest(project.project);
		const target = normalizePath(filePath);
		const entry = manifest.get(target);
		if (!entry) {
			const name = target.split('/').pop().toLowerCase();
			const similar = [...manifest.keys()].filter((candidate) =>
				candidate.toLowerCase().endsWith(`/${name}`),
			);
			throw new ToolError(
				`No file ${target} in this project.${similar.length ? ` Did you mean ${similar.join(', ')}?` : ' Use list_files.'}`,
			);
		}
		const content = await files.read(project.project, entry);
		if (!content) {
			throw new ToolError(
				`The server does not have the contents of ${target} yet: open the project in Feuillet so that they are sent.`,
			);
		}
		return { path: target, entry, content };
	};

	const textFileOf = async (project, filePath) => {
		const file = await fileOf(project, filePath);
		if (file.content.text === undefined) {
			throw new ToolError(`${file.path} is not a text file (${sizeText(file.content.bytes.length)}).`);
		}
		return file;
	};

	const requireAccess = (project, needed) => {
		const rank = { view: 1, review: 2, edit: 3 };
		if (rank[project.access] >= rank[needed]) return;
		throw new ToolError(
			needed === 'edit'
				? `This account ${ACCESS_TEXT[project.access]} in this project: it cannot change files directly.`
				: 'This account can only read this project.',
		);
	};

	/**
	 * Changes a text file: `apply(text)` returns {text, ...result} from its
	 * stored text, comments and tracked changes included.
	 */
	const changeText = async (context, project, file, apply) => {
		if (file.content.unsaved) {
			throw new ToolError(
				`${file.path} is open in an editor that has not sent its text to the server yet. Open the project in Feuillet, then try again.`,
			);
		}
		const author = authorOf(context);
		if (file.content.document) {
			const result = await files.changeDocument(
				project.project,
				file.entry.documentId,
				(ytext) => {
					const before = ytext.toString();
					const outcome = apply(before);
					// The smallest change, so that collaborators' cursors stay put.
					let start = 0;
					const after = outcome.text;
					while (start < before.length && start < after.length && before[start] === after[start]) start++;
					let endBefore = before.length;
					let endAfter = after.length;
					while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
						endBefore--;
						endAfter--;
					}
					if (endBefore > start) ytext.delete(start, endBefore - start);
					if (endAfter > start) ytext.insert(start, after.slice(start, endAfter));
					return outcome;
				},
			);
			history.record(project.project, `yjs_${file.entry.documentId}`, [author]);
			return result;
		}
		if (project.access !== 'edit') {
			throw new ToolError(
				`Reviewers can change only files opened in Feuillet's editor, and ${file.path} has not been yet.`,
			);
		}
		const outcome = apply(file.content.text);
		await files.writeFile(project.project, file.path, outcome.text, author);
		history.record(project.project, 'file_sync', [author]);
		return outcome;
	};

	// ---- Tools

	const tools = [
		{
			name: 'list_projects',
			title: 'List projects',
			description:
				"Lists the Feuillet projects of the signed-in account, with each project's id (used by the other tools) and what the account may do in it.",
			inputSchema: { type: 'object', properties: {}, additionalProperties: false },
			annotations: { readOnlyHint: true, openWorldHint: false },
			run: (context) => {
				const projects = projectsOf(context.account);
				if (!projects.length) {
					return 'This account has no projects on the server yet. Projects appear here once they are opened in Feuillet while signed in.';
				}
				return [
					`${projects.length} project${projects.length > 1 ? 's' : ''} of ${context.username}:`,
					...projects.map(({ entry, access, role }) => {
						const details = [
							entry.type === 'typst' ? 'Typst' : 'LaTeX',
							ACCESS_TEXT[access],
							role === 'owner' || entry.owner === 'you'
								? 'owner: you'
								: entry.ownerName
									? `owner: ${entry.ownerName}`
									: '',
							entry.archived ? 'archived' : '',
							entry.updatedAt ? `updated ${dateText(entry.updatedAt)}` : '',
						].filter(Boolean);
						return `- ${entry.name || '(untitled)'} — id: ${entry.id} — ${details.join('; ')}`;
					}),
				].join('\n');
			},
		},
		{
			name: 'list_files',
			title: 'List files',
			description:
				"Lists a project's files with their sizes, and names its main file. Paths start with /.",
			inputSchema: {
				type: 'object',
				properties: { project: { type: 'string', description: 'The project id from list_projects' } },
				required: ['project'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				const manifest = await files.manifest(project.project);
				const { metadata } = await files.settings(project.project);
				const main = await mainFileOf(project.project, metadata, manifest);
				const paths = [...manifest.keys()].sort((a, b) => a.localeCompare(b));
				return [
					`Project ${quote(project.entry.name)} (${ACCESS_TEXT[project.access]}); main file: ${main ?? 'not set'}; ${paths.length} files:`,
					...paths.map((filePath) => {
						const entry = manifest.get(filePath);
						const kind = entry.documentId || isTextPath(filePath) ? 'text' : 'binary';
						return `${filePath}  (${sizeText(entry.size ?? 0)}, ${kind})`;
					}),
				].join('\n');
			},
		},
		{
			name: 'read_file',
			title: 'Read a file',
			description:
				"Reads a text file of a project as collaborators see it now, pending suggestions shown as made, with numbered lines (the numbers are not part of the text), followed by the file's open comments and suggestions. Long files are read in parts with start_line.",
			inputSchema: {
				type: 'object',
				properties: {
					project: { type: 'string', description: 'The project id from list_projects' },
					path: { type: 'string', description: 'The file path, such as /main.tex' },
					start_line: { type: 'integer', minimum: 1, description: 'First line to read (default 1)' },
					end_line: { type: 'integer', minimum: 1, description: 'Last line to read (default: as many as fit)' },
				},
				required: ['project', 'path'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				const file = await textFileOf(project, args.path);
				const view = cleanView(file.content.text);
				const lines = view.text.split('\n');
				const first = Math.max(1, Number(args.start_line) || 1);
				if (first > lines.length) {
					throw new ToolError(`${file.path} has ${lines.length} lines.`);
				}
				const wantedLast = Math.min(lines.length, Number(args.end_line) || lines.length);
				const shown = [];
				let size = 0;
				let last = first - 1;
				for (let n = first; n <= wantedLast; n++) {
					const line = `${String(n).padStart(6)}\t${lines[n - 1]}`;
					if (size + line.length > MAX_READ_CHARS && shown.length) break;
					shown.push(line);
					size += line.length + 1;
					last = n;
				}
				const parts = [
					`${file.path}, lines ${first}–${last} of ${lines.length}${
						last < lines.length ? ` (read on with start_line ${last + 1})` : ''
					}:`,
					shown.join('\n'),
				];
				const open = annotationsOf(file.content.text).filter((note) => !note.resolved);
				if (open.length) {
					parts.push('', 'Open comments and suggestions in this file:', ...open.map(describeNote));
				}
				return parts.join('\n');
			},
		},
		{
			name: 'search',
			title: 'Search a project',
			description:
				"Finds the lines of a project's text files that contain some text, as collaborators see them now.",
			inputSchema: {
				type: 'object',
				properties: {
					project: { type: 'string', description: 'The project id from list_projects' },
					query: { type: 'string', description: 'The text to find' },
					case_sensitive: { type: 'boolean', description: 'Tell capitals apart (default false)' },
					path: { type: 'string', description: 'Search only this file or folder' },
				},
				required: ['project', 'query'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				const query = String(args.query ?? '');
				if (!query) throw new ToolError('The query must not be empty.');
				// Plain text only: a regular expression could keep the server busy.
				const wanted = args.case_sensitive ? query : query.toLowerCase();
				const matches = (line) =>
					(args.case_sensitive ? line : line.toLowerCase()).includes(wanted);
				const scope = args.path ? normalizePath(args.path) : null;
				const manifest = await files.manifest(project.project);
				const results = [];
				let total = 0;
				for (const [filePath, entry] of [...manifest].sort(([a], [b]) => a.localeCompare(b))) {
					if (scope && filePath !== scope && !filePath.startsWith(`${scope}/`)) continue;
					if (!entry.documentId && !isTextPath(filePath)) continue;
					const content = await files.read(project.project, entry);
					if (content?.text === undefined) continue;
					strip(content.text)
						.split('\n')
						.forEach((line, index) => {
							if (!matches(line)) return;
							total++;
							if (results.length < MAX_SEARCH_RESULTS) {
								results.push(`${filePath}:${index + 1}: ${line.length > 300 ? `${line.slice(0, 300)}…` : line}`);
							}
						});
				}
				if (!total) return `No line matches ${quote(query)}.`;
				return [
					`${total} matching line${total > 1 ? 's' : ''}${total > results.length ? ` (first ${results.length} shown)` : ''}:`,
					...results,
				].join('\n');
			},
		},
		{
			name: 'list_review',
			title: 'List comments and suggestions',
			description:
				"Lists the open comments and suggested changes (tracked changes) of a project's files, with their ids, authors, replies and lines.",
			inputSchema: {
				type: 'object',
				properties: {
					project: { type: 'string', description: 'The project id from list_projects' },
					include_resolved: { type: 'boolean', description: 'Also list resolved comments' },
				},
				required: ['project'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				const manifest = await files.manifest(project.project);
				const parts = [];
				for (const [filePath, entry] of [...manifest].sort(([a], [b]) => a.localeCompare(b))) {
					if (!entry.documentId && !isTextPath(filePath)) continue;
					const content = await files.read(project.project, entry);
					if (content?.text === undefined) continue;
					const notes = annotationsOf(content.text).filter(
						(note) => args.include_resolved || !note.resolved,
					);
					if (notes.length) parts.push(`${filePath}:`, ...notes.map(describeNote));
				}
				return parts.length ? parts.join('\n') : 'No open comments or suggestions.';
			},
		},
		{
			name: 'edit_file',
			title: 'Change a file',
			description:
				"Replaces a passage of a text file. old_text must appear exactly once in the file as read_file shows it (without line numbers); include enough surrounding text. By default the change is a suggestion (tracked change) that collaborators accept or reject in Feuillet; mode 'direct' changes the text at once, for editors in projects that do not track their changes. The passage may not cross a comment's or another suggestion's boundaries.",
			inputSchema: {
				type: 'object',
				properties: {
					project: { type: 'string', description: 'The project id from list_projects' },
					path: { type: 'string', description: 'The file path, such as /main.tex' },
					old_text: { type: 'string', description: 'The exact passage to replace' },
					new_text: { type: 'string', description: 'What replaces it (empty to delete it)' },
					mode: {
						type: 'string',
						enum: ['suggest', 'direct'],
						description: "'suggest' (default) or 'direct'",
					},
				},
				required: ['project', 'path', 'old_text', 'new_text'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				requireAccess(project, 'review');
				const oldText = String(args.old_text ?? '');
				const newText = String(args.new_text ?? '');
				if (oldText === newText) throw new ToolError('old_text and new_text are the same.');
				refuseTags(newText, 'new_text');
				const { metadata } = await files.settings(project.project);
				const forced = tracked(metadata, context.username);
				let direct = args.mode === 'direct';
				if (direct) requireAccess(project, 'edit');
				if (direct && forced) direct = false;
				const file = await textFileOf(project, args.path);
				const author = authorOf(context);
				const outcome = await changeText(context, project, file, (text) => {
					const view = cleanView(text);
					const at = locate(view.text, oldText, 'old_text');
					const hunks = diffWords(oldText, newText);
					const reviews = view.matches.filter((match) => match.kind === 'review');
					const edits = hunks.map((hunk) => {
						const start = view.rawStart(at + hunk.from);
						const end = hunk.to > hunk.from ? view.rawEnd(at + hunk.to) : start;
						if (view.ranges.some((range) => range.from < end && range.to > start)) {
							throw new ToolError(
								'The changed words cross the start or end of a comment or of a suggestion. Change a smaller passage, or have the suggestion accepted or rejected first.',
							);
						}
						if (reviews.some((match) => start >= match.innerStart && end <= match.innerEnd && match.innerEnd > match.innerStart)) {
							throw new ToolError(
								'This passage is part of a pending suggestion: have it accepted or rejected in Feuillet first.',
							);
						}
						const removed = oldText.slice(hunk.from, hunk.to);
						if (direct) return { start, end, insert: hunk.insert };
						const tags = reviewTags(author, removed);
						return { start, end, insert: `${tags.open}${hunk.insert}${tags.close}` };
					});
					let result = text;
					for (const edit of [...edits].reverse()) {
						result = result.slice(0, edit.start) + edit.insert + result.slice(edit.end);
					}
					return { text: result, line: lineOf(view.text, at), count: edits.length };
				});
				const where = `${file.path} (line ${outcome.line})`;
				if (direct) return `Changed ${where}.`;
				return `Suggested ${outcome.count} change${outcome.count > 1 ? 's' : ''} in ${where}${
					args.mode === 'direct' && forced ? ' (this project tracks your changes, so they are suggestions)' : ''
				}. Collaborators accept or reject ${outcome.count > 1 ? 'them' : 'it'} in Feuillet's review panel; read_file shows the text as if accepted.`;
			},
		},
		{
			name: 'create_file',
			title: 'Create a file',
			description:
				'Creates a new text file in a project, such as a chapter or a bibliography; editors only. To change an existing file, use edit_file.',
			inputSchema: {
				type: 'object',
				properties: {
					project: { type: 'string', description: 'The project id from list_projects' },
					path: { type: 'string', description: 'The new file path, such as /chapters/conclusion.tex' },
					content: { type: 'string', description: "The file's text" },
				},
				required: ['project', 'path', 'content'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				requireAccess(project, 'edit');
				const target = normalizePath(args.path);
				if (target.length > 300 || /[\u0000-\u001f<>:"|?*]/.test(target)) {
					throw new ToolError('This path has characters that file names may not have.');
				}
				if (!isTextPath(target)) {
					throw new ToolError('Only text files can be created, such as .tex, .bib or .sty files.');
				}
				const manifest = await files.manifest(project.project);
				if (manifest.has(target)) throw new ToolError(`${target} already exists: use edit_file.`);
				const content = String(args.content ?? '');
				refuseTags(content, 'content');
				if (Buffer.byteLength(content) > 5 * 1024 * 1024) throw new ToolError('This file is too large.');
				const author = authorOf(context);
				await files.writeFile(project.project, target, content, author);
				history.record(project.project, 'file_sync', [author]);
				return `Created ${target} (${sizeText(Buffer.byteLength(content))}). Collaborators' editors show it once they have it.`;
			},
		},
		{
			name: 'add_comment',
			title: 'Comment on a passage',
			description:
				"Adds a comment on a passage of a text file, as in Feuillet's review panel. quote must appear exactly once in the file as read_file shows it, and may not cross another comment's or a suggestion's boundaries.",
			inputSchema: {
				type: 'object',
				properties: {
					project: { type: 'string', description: 'The project id from list_projects' },
					path: { type: 'string', description: 'The file path, such as /main.tex' },
					quote: { type: 'string', description: 'The exact passage the comment is about' },
					comment: { type: 'string', description: 'The comment' },
				},
				required: ['project', 'path', 'quote', 'comment'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				requireAccess(project, 'review');
				const comment = String(args.comment ?? '').trim();
				if (!comment) throw new ToolError('The comment must not be empty.');
				const file = await textFileOf(project, args.path);
				const author = authorOf(context);
				const outcome = await changeText(context, project, file, (text) => {
					const view = cleanView(text);
					const part = String(args.quote ?? '');
					const at = locate(view.text, part, 'quote');
					const start = view.rawStart(at);
					const end = view.rawEnd(at + part.length);
					if (view.ranges.some((range) => range.from < end && range.to > start)) {
						throw new ToolError(
							'The passage crosses the start or end of another comment or of a suggestion. Choose a smaller passage.',
						);
					}
					const tags = commentTags(author, comment);
					return {
						text: text.slice(0, start) + tags.open + text.slice(start, end) + tags.close + text.slice(end),
						line: lineOf(view.text, at),
					};
				});
				return `Comment added on ${file.path} (line ${outcome.line}).`;
			},
		},
		{
			name: 'reply_to_comment',
			title: 'Reply to a comment',
			description:
				'Replies to a comment or to a suggestion, by its id from read_file or list_review.',
			inputSchema: {
				type: 'object',
				properties: {
					project: { type: 'string', description: 'The project id from list_projects' },
					path: { type: 'string', description: 'The file the comment is in' },
					id: { type: 'string', description: 'The comment or suggestion id' },
					reply: { type: 'string', description: 'The reply' },
				},
				required: ['project', 'path', 'id', 'reply'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				requireAccess(project, 'review');
				const reply = String(args.reply ?? '').trim();
				if (!reply) throw new ToolError('The reply must not be empty.');
				const file = await textFileOf(project, args.path);
				const author = authorOf(context);
				await changeText(context, project, file, (text) => {
					const match = scanAll(text).find((entry) => entry.id === String(args.id));
					if (!match) throw new ToolError(`No comment or suggestion ${args.id} in ${file.path}.`);
					return { text: withResponse(text, match, author, reply) };
				});
				return `Reply added in ${file.path}.`;
			},
		},
		{
			name: 'compile',
			title: 'Compile',
			description:
				"Compiles a LaTeX project with TeX Live, as Feuillet's Compile button does, pending suggestions included, and reports the errors and warnings with their files and lines.",
			inputSchema: {
				type: 'object',
				properties: {
					project: { type: 'string', description: 'The project id from list_projects' },
					main_file: { type: 'string', description: "The file to compile (default: the project's main file)" },
				},
				required: ['project'],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
			run: async (context, args) => {
				const project = findProject(context.account, args.project);
				if (!compiler) throw new ToolError('This server does not compile projects.');
				if (project.entry.type === 'typst') {
					throw new ToolError('Only LaTeX projects can be compiled here.');
				}
				const manifest = await files.manifest(project.project);
				const { metadata } = await files.settings(project.project);
				const mainFile = args.main_file
					? normalizePath(args.main_file)
					: await mainFileOf(project.project, metadata, manifest);
				if (!mainFile || !manifest.has(mainFile)) {
					throw new ToolError(
						mainFile ? `No file ${mainFile} in this project.` : 'This project has no main file: give main_file.',
					);
				}
				const sources = [];
				let total = 0;
				const missing = [];
				for (const [filePath, entry] of manifest) {
					const content = await files.read(project.project, entry);
					if (!content) {
						missing.push(filePath);
						continue;
					}
					const bytes =
						content.text !== undefined
							? Buffer.from(strip(content.text), 'utf8')
							: content.bytes;
					total += bytes.length;
					if (total > MAX_COMPILE_BYTES) throw new ToolError('This project is too large to compile here.');
					sources.push({ path: filePath, bytes });
				}
				const engineOption = metadata.typesetterOptions?.texlive?.engine;
				const engine = ENGINES.includes(engineOption) ? engineOption : 'pdflatex';
				let result;
				try {
					result = await compiler.compile({ files: sources, mainFile, engine });
				} catch (error) {
					throw new ToolError(error.message);
				}
				const summary = summarizeLog(result.log);
				const lines = [
					`Compiled ${mainFile} with ${engine}: ${
						result.pdf
							? result.status === 0
								? 'PDF made without errors'
								: 'PDF made, with errors'
							: 'no PDF'
					}${summary.pages ? `, ${summary.pages} page${summary.pages > 1 ? 's' : ''}` : ''}.`,
				];
				if (missing.length) {
					lines.push(`Files the server does not have yet, left out: ${missing.join(', ')}.`);
				}
				if (summary.errors.length) {
					lines.push('', `${summary.errors.length} error${summary.errors.length > 1 ? 's' : ''}:`);
					for (const error of summary.errors.slice(0, 30)) {
						lines.push(
							`- ${error.file ?? '?'}${error.line ? `:${error.line}` : ''}: ${error.message}${
								error.context ? `\n    ${error.context.replace(/\n/g, '\n    ')}` : ''
							}`,
						);
					}
				}
				if (summary.warnings.length) {
					lines.push('', `${summary.warnings.length} warning${summary.warnings.length > 1 ? 's' : ''}:`);
					for (const warning of summary.warnings.slice(0, 40)) {
						lines.push(`- ${warning.file ?? '?'}${warning.line ? `:${warning.line}` : ''}: ${warning.message}`);
					}
				}
				if (!result.pdf && !summary.errors.length) {
					lines.push('', 'End of the log:', result.log.slice(-4000));
				}
				return lines.join('\n');
			},
		},
	];

	function describeNote(note) {
		const replies = note.responses.length
			? ` Replies: ${note.responses.map((response) => `${response.user}: ${quote(response.content, 120)}`).join('; ')}.`
			: '';
		const state = note.resolved ? ' (resolved)' : '';
		if (note.kind === 'comment') {
			return `- comment ${note.id}${state}, line ${note.line}, by ${note.user} on ${quote(note.text, 100)}: ${quote(note.comment, 400)}.${replies}`;
		}
		const change = !note.original
			? `inserts ${quote(note.text)}`
			: !note.text
				? `deletes ${quote(note.original)}`
				: `replaces ${quote(note.original)} with ${quote(note.text)}`;
		return `- suggestion ${note.id}${state}, line ${note.line}, by ${note.user}: ${change}.${replies}`;
	}

	const INSTRUCTIONS = [
		'Feuillet is a collaborative LaTeX editor, like Overleaf. These tools work on the projects of the account that connected, with its role in each project.',
		'Start with list_projects, then list_files and read_file; search finds text across a project.',
		"edit_file proposes changes as suggestions (tracked changes) by default, which the project's people accept or reject in Feuillet; keep each edit to the passage that changes. add_comment and reply_to_comment work as in Feuillet's review panel; list_review lists what is open.",
		'compile runs TeX Live on the project and reports errors with their files and lines; use it to check changes.',
		'Paths start with /. Collaborators may be editing at the same time: read a passage again before changing it.',
	].join('\n');

	// ---- JSON-RPC

	const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
	const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

	const dispatch = async (message, context) => {
		const { id, method, params = {} } = message;
		switch (method) {
			case 'initialize':
				return result(id, {
					protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion)
						? params.protocolVersion
						: PROTOCOL_VERSIONS[0],
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: 'feuillet', title: 'Feuillet', version },
					instructions: INSTRUCTIONS,
				});
			case 'ping':
				return result(id, {});
			case 'tools/list':
				return result(id, {
					tools: tools.map(({ run, ...tool }) => tool),
				});
			case 'tools/call': {
				const tool = tools.find((entry) => entry.name === params.name);
				if (!tool) return failure(id, -32602, `Unknown tool: ${params.name}`);
				const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
				try {
					const text = await tool.run(context, args);
					return result(id, { content: [{ type: 'text', text }], isError: false });
				} catch (error) {
					if (!(error instanceof ToolError)) {
						log('assistant tool failed', tool.name, error);
					}
					return result(id, {
						content: [
							{
								type: 'text',
								text: error instanceof ToolError ? error.message : 'The server could not do this.',
							},
						],
						isError: true,
					});
				}
			}
			default:
				return failure(id, -32601, `Method not found: ${method}`);
		}
	};

	const readJson = (req) =>
		new Promise((resolve, reject) => {
			let size = 0;
			const chunks = [];
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					reject(new Error('too_large'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
				} catch {
					reject(new Error('parse_error'));
				}
			});
			req.on('error', () => reject(new Error('interrupted')));
		});

	const CORS = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
	};
	const send = (res, status, body, headers = {}) => {
		res.writeHead(status, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			...CORS,
			...headers,
		});
		res.end(body === undefined ? '' : JSON.stringify(body));
	};

	const handles = (url) => url === '/mcp' || url === '/mcp/';

	// Tokens, not cookies, carry who calls, so any origin may.
	const handle = async (req, res) => {
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				...CORS,
				'Access-Control-Allow-Methods': 'POST, GET, DELETE',
				'Access-Control-Allow-Headers':
					'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
				'Access-Control-Max-Age': '86400',
			});
			res.end();
			return;
		}
		const auth = oauth.authenticate(req);
		if (!auth.grant) {
			req.resume();
			send(
				res,
				401,
				{ error: auth.error ?? 'unauthorized' },
				{ 'WWW-Authenticate': oauth.challenge(req, auth.error) },
			);
			return;
		}
		if (req.method !== 'POST') {
			req.resume();
			send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
			return;
		}
		const requested = req.headers['mcp-protocol-version'];
		if (requested && !PROTOCOL_VERSIONS.includes(requested)) {
			req.resume();
			send(res, 400, failure(null, -32600, `Unsupported MCP-Protocol-Version: ${requested}`));
			return;
		}
		let body;
		try {
			body = await readJson(req);
		} catch (error) {
			send(
				res,
				error.message === 'too_large' ? 413 : 400,
				failure(null, -32700, error.message === 'too_large' ? 'Request too large' : 'Parse error'),
			);
			return;
		}
		const context = {
			account: auth.account,
			username: auth.account.username,
			clientName: auth.grant.clientName,
		};
		const messages = Array.isArray(body) ? body : [body];
		const replies = [];
		for (const message of messages) {
			if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
				replies.push(failure(message?.id ?? null, -32600, 'Invalid request'));
				continue;
			}
			// Notifications and responses need no answer.
			if (typeof message.method !== 'string' || message.id === undefined) continue;
			replies.push(await dispatch(message, context));
		}
		if (!replies.length) {
			res.writeHead(202, CORS);
			res.end();
			return;
		}
		send(res, 200, Array.isArray(body) ? replies : replies[0]);
	};

	return { handles, handle };
};

module.exports = { createMcp, diffWords };
