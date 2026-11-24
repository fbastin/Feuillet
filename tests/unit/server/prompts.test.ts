/**
 * @jest-environment node
 */
// Requests to assistants as feuillet.sty reads them (server/collab/prompts.js):
// the request's characters as written, its braces pairing; not in comments
// nor verbatim; \prompt only while the project has no \prompt of its own.
const {
	agentMatches,
	definesPrompt,
	findRequests,
	loadsFeuillet,
	requestsOf,
} = require('../../../server/collab/prompts.js');

describe('requests to assistants', () => {
	it('reads a request as written, with its assistant and line', () => {
		const text = [
			'\\section{Intro}',
			'Avant. \\prompt{Rédige à partir de \\alpha_1 {x} 50% #1 & ~ $y$} Après.',
			'\\prompt [claude] {deux',
			'',
			'paragraphes}',
			'\\feuilletprompt[Claude Code]{x}',
		].join('\n');
		const requests = findRequests(text);
		expect(requests.map((r: { text: string; agent: string; line: number; command: string }) => [r.text, r.agent, r.line, r.command])).toEqual([
			['Rédige à partir de \\alpha_1 {x} 50% #1 & ~ $y$', '', 2, 'prompt'],
			['deux\n\nparagraphes', 'claude', 3, 'prompt'],
			['x', 'Claude Code', 6, 'feuilletprompt'],
		]);
		expect(text.slice(requests[0].start, requests[0].end)).toBe(requests[0].source);
		expect(requests[0].source).toBe('\\prompt{Rédige à partir de \\alpha_1 {x} 50% #1 & ~ $y$}');
	});

	it('leaves out comments, verbatim, line breaks and other commands', () => {
		const text = [
			'% \\prompt{in a comment}',
			'Text. % \\prompt{after a comment}',
			'50\\% \\prompt{after an escaped percent}',
			'\\begin{verbatim}',
			'\\prompt{in verbatim}',
			'\\end{verbatim}',
			'\\\\prompt{after a line break}',
			'\\prompts{other} \\promptx{other}',
			'\\prompt{unclosed',
		].join('\n');
		expect(findRequests(text).map((r: { text: string }) => r.text)).toEqual(['after an escaped percent']);
	});

	it('takes only \\feuilletprompt when the project has its own \\prompt', () => {
		const text = '\\prompt{a shell prompt} \\feuilletprompt{a request}';
		expect(findRequests(text, { ownPrompt: true }).map((r: { text: string }) => r.text)).toEqual(['a request']);
		expect(definesPrompt('\\newcommand{\\prompt}[1]{\\texttt{#1}}')).toBe(true);
		expect(definesPrompt('\\NewDocumentCommand\\prompt{m}{#1}')).toBe(true);
		expect(definesPrompt('\\def\\prompt#1{#1}')).toBe(true);
		expect(definesPrompt('\\newenvironment{prompt}{}{}')).toBe(true);
		expect(definesPrompt('% \\newcommand{\\prompt}{x}\n\\prompt{y}')).toBe(false);
		expect(definesPrompt('\\newcommand{\\promptstyle}{x}')).toBe(false);
	});

	it('knows whether the project loads feuillet.sty', () => {
		expect(loadsFeuillet('\\usepackage{feuillet}')).toBe(true);
		expect(loadsFeuillet('\\usepackage[final]{amsmath, feuillet}')).toBe(true);
		expect(loadsFeuillet('% \\usepackage{feuillet}')).toBe(false);
		expect(loadsFeuillet('\\usepackage{feuilletage}')).toBe(false);
	});

	it('gives a request to any assistant, or to those whose name holds its own', () => {
		expect(agentMatches('', 'Claude Code')).toBe(true);
		expect(agentMatches('claude', 'Claude')).toBe(true);
		expect(agentMatches('claude', 'Claude Code')).toBe(true);
		expect(agentMatches('claude code', 'Claude')).toBe(false);
		expect(agentMatches('claude-code', 'Claude Code')).toBe(true);
		expect(agentMatches('codex', 'Claude Code')).toBe(false);
	});

	it('gives each request an id that holds while the rest of the file changes', () => {
		const before = requestsOf('/main.tex', 'A \\prompt{x} B \\prompt{x}');
		const after = requestsOf('/main.tex', 'New text.\n\nA \\prompt{x} B \\prompt{x}');
		expect(before.map((r: { id: string }) => r.id)).toEqual(after.map((r: { id: string }) => r.id));
		expect(before[0].id).not.toBe(before[1].id);
		expect(requestsOf('/other.tex', 'A \\prompt{x}')[0].id).not.toBe(before[0].id);
	});
});
