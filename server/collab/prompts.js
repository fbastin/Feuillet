// server/collab/prompts.js
// Requests to assistants, which a project's LaTeX files write with
// feuillet.sty (server/texlive/texmf/tex/latex/feuillet/feuillet.sty):
//
//   \prompt{Write a paragraph that sums up section 2.}
//   \prompt[claude]{Check this proof's notation.}
//   \feuilletprompt[claude]{...}     the same, always defined
//
// read as the package reads them: the request's characters as written, its
// braces pairing, backslashes and percent signs its own. \prompt counts
// unless the project defines a \prompt of its own, as feuillet.sty then
// leaves it alone; requests in comments and verbatim environments do not.
//
// An assistant answers a request with a suggestion that replaces it
// (mcp.js): read in the text as collaborators see it, pending suggestions
// shown as made, a request being answered is no longer there, and one
// whose answer is rejected is back.

const crypto = require('node:crypto');

// The files requests are written in.
const REQUEST_EXTENSIONS = new Set(['tex', 'ltx', 'latex']);
// Files whose definitions count, \prompt's included.
const DEFINITION_EXTENSIONS = new Set(['tex', 'ltx', 'latex', 'sty', 'cls']);
const VERBATIM = /\\begin\s*\{(verbatim\*?|Verbatim\*?|BVerbatim|LVerbatim|lstlisting|minted|comment|filecontents\*?|alltt)\}/g;
const COMMAND = /\\(prompt|feuilletprompt)(?![A-Za-z@])/g;
const MAX_AGENT = 60;

const extensionOf = (filePath) => (/\.([^./]+)$/.exec(filePath)?.[1] ?? '').toLowerCase();
const isRequestFile = (filePath) => REQUEST_EXTENSIONS.has(extensionOf(filePath));
const isDefinitionFile = (filePath) => DEFINITION_EXTENSIONS.has(extensionOf(filePath));

/** Whether a % before `offset` on its line makes it a comment. */
const inComment = (text, offset) => {
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	for (let at = lineStart; at < offset; at++) {
		if (text[at] !== '%') continue;
		let slashes = 0;
		for (let back = at - 1; back >= lineStart && text[back] === '\\'; back--) slashes++;
		if (slashes % 2 === 0) return true;
	}
	return false;
};

/** The text without its comments, line by line. */
const withoutComments = (text) =>
	text
		.split('\n')
		.map((line) => {
			for (let at = 0; at < line.length; at++) {
				if (line[at] !== '%') continue;
				let slashes = 0;
				for (let back = at - 1; back >= 0 && line[back] === '\\'; back--) slashes++;
				if (slashes % 2 === 0) return line.slice(0, at);
			}
			return line;
		})
		.join('\n');

/** [from, to) of the verbatim environments, whose text is not LaTeX's. */
const verbatimRanges = (text) => {
	const ranges = [];
	VERBATIM.lastIndex = 0;
	for (let match = VERBATIM.exec(text); match; match = VERBATIM.exec(text)) {
		if (inComment(text, match.index)) continue;
		const name = match[1].replace(/[*]/g, '\\*');
		const end = new RegExp(`\\\\end\\s*\\{${name}\\}`, 'g');
		end.lastIndex = match.index + match[0].length;
		const closing = end.exec(text);
		const to = closing ? closing.index + closing[0].length : text.length;
		ranges.push([match.index, to]);
		VERBATIM.lastIndex = to;
	}
	return ranges;
};

/** Spaces, and one line end, as TeX skips them before an argument. */
const skipSpaces = (text, at) => {
	let pos = at;
	let lineEnds = 0;
	while (pos < text.length) {
		const char = text[pos];
		if (char === ' ' || char === '\t' || char === '\r') pos++;
		else if (char === '\n' && lineEnds === 0) {
			lineEnds++;
			pos++;
		} else break;
	}
	return pos;
};

/**
 * The requests of a file's text: [{start, end, source, command, agent,
 * text, line}], offsets in `text`; `agent` is '' for any assistant.
 * `ownPrompt`: the project defines \prompt itself, so only
 * \feuilletprompt makes requests.
 */
const findRequests = (text, { ownPrompt = false } = {}) => {
	const requests = [];
	if (!text.includes('prompt')) return requests;
	const verbatim = verbatimRanges(text);
	COMMAND.lastIndex = 0;
	for (let match = COMMAND.exec(text); match; match = COMMAND.exec(text)) {
		const start = match.index;
		const command = match[1];
		if (command === 'prompt' && ownPrompt) continue;
		// \\prompt is a line break, then a word.
		let slashes = 0;
		for (let back = start - 1; back >= 0 && text[back] === '\\'; back--) slashes++;
		if (slashes % 2 === 1) continue;
		if (inComment(text, start) || verbatim.some(([from, to]) => start >= from && start < to)) continue;
		let pos = skipSpaces(text, start + match[0].length);
		let agent = '';
		if (text[pos] === '[') {
			const close = text.indexOf(']', pos + 1);
			if (close === -1) continue;
			agent = text.slice(pos + 1, close).replace(/\s+/g, ' ').trim().slice(0, MAX_AGENT);
			pos = skipSpaces(text, close + 1);
		}
		if (text[pos] !== '{') continue;
		let depth = 0;
		let end = -1;
		for (let at = pos; at < text.length; at++) {
			if (text[at] === '{') depth++;
			else if (text[at] === '}') {
				depth--;
				if (depth === 0) {
					end = at + 1;
					break;
				}
			}
		}
		if (end === -1) continue;
		requests.push({
			start,
			end,
			source: text.slice(start, end),
			command,
			agent,
			text: text.slice(pos + 1, end - 1).trim(),
			line: text.slice(0, start).split('\n').length,
		});
		COMMAND.lastIndex = end;
	}
	return requests;
};

const DEFINES_PROMPT =
	/\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|(?:New|Renew|Provide|Declare)DocumentCommand|NewCommandCopy|(?:global\s*\\)?let|[gex]?def)\*?\s*\{?\s*\\prompt(?![A-Za-z@])|\\(?:re)?newenvironment\*?\s*\{\s*prompt\s*\}|\\(?:New|Renew|Provide|Declare)DocumentEnvironment\s*\{\s*prompt\s*\}/;

/** Whether a file defines a \prompt (or a prompt environment) of its own. */
const definesPrompt = (text) => text.includes('prompt') && DEFINES_PROMPT.test(withoutComments(text));

const LOADS = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;

/** Whether a file loads feuillet.sty. */
const loadsFeuillet = (text) => {
	if (!text.includes('feuillet')) return false;
	for (const match of withoutComments(text).matchAll(LOADS)) {
		if (match[1].split(',').some((name) => name.trim() === 'feuillet')) return true;
	}
	return false;
};

// Names compared as letters and digits, without case nor accents.
const simplify = (name) =>
	String(name ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');

/**
 * Whether a request for `agent` is for the assistant named `name`: any is,
 * when it names none; else one whose name holds it, so that "claude" is for
 * Claude (claude.ai) and Claude Code, "claude code" for Claude Code only.
 */
const agentMatches = (agent, name) => {
	const wanted = simplify(agent);
	return !wanted || simplify(name).includes(wanted);
};

/**
 * A request's id: where it is and what it says, and which of the same it
 * is in its file, so that it holds while the rest of the file changes.
 */
const requestId = (filePath, request, sameBefore = 0) =>
	crypto
		.createHash('sha256')
		.update(`${filePath}\0${request.source}\0${sameBefore}`)
		.digest('base64url')
		.slice(0, 12);

/** The requests of a file, each with its id. */
const requestsOf = (filePath, text, options) => {
	const seen = new Map();
	return findRequests(text, options).map((request) => {
		const sameBefore = seen.get(request.source) ?? 0;
		seen.set(request.source, sameBefore + 1);
		return { ...request, id: requestId(filePath, request, sameBefore) };
	});
};

module.exports = {
	agentMatches,
	definesPrompt,
	findRequests,
	isDefinitionFile,
	isRequestFile,
	loadsFeuillet,
	requestsOf,
	simplify,
};
