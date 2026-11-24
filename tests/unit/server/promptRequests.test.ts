/**
 * @jest-environment node
 */
// Requests to assistants (\prompt, feuillet.sty) through the connector
// (server/collab/mcp.js): listed for the assistant they are for, answered
// with a suggestion that replaces them; and answered from Feuillet itself
// by Claude through the API (server/collab/promptRunner.js), here with a
// stand-in for Anthropic's client.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const { createMcp } = require('../../../server/collab/mcp.js');
const { createPromptRunner, echoed } = require('../../../server/collab/promptRunner.js');
const { cleanView, scanAll } = require('../../../server/collab/annotations.js');
const { requestsOf } = require('../../../server/collab/prompts.js');

const MAIN = [
	'\\documentclass{article}',
	'\\usepackage{feuillet}',
	'\\begin{document}',
	'\\section{Introduction}',
	'Some text. \\prompt{Write one sentence on fluids.}',
	'',
	'\\prompt[codex]{For another assistant.}',
	'\\end{document}',
].join('\n');

const account = {
	id: 'a1',
	username: 'ada',
	projects: [{ id: 'p1', name: 'Notes', type: 'latex' }],
};

// One project, its main.tex a shared document.
const setUp = (initial = MAIN) => {
	const doc = { text: initial };
	const ytext = {
		toString: () => doc.text,
		delete: (at: number, length: number) => {
			doc.text = doc.text.slice(0, at) + doc.text.slice(at + length);
		},
		insert: (at: number, value: string) => {
			doc.text = doc.text.slice(0, at) + value + doc.text.slice(at);
		},
	};
	const mcp = createMcp({
		oauth: { authenticate: () => ({}), challenge: () => 'Bearer' },
		shares: {
			accessOf: (_account: string, id: string) =>
				id === 'p1' ? { project: 'p1', role: 'owner', access: 'edit' } : null,
		},
		files: {
			manifest: async () => new Map([['/main.tex', { id: 'f1', documentId: 'd1' }]]),
			settings: async () => ({ metadata: {} }),
			read: async () => ({ text: doc.text, document: true }),
			changeDocument: async (_project: string, _document: string, change: (y: typeof ytext) => unknown) =>
				change(ytext),
		},
		history: { record: () => {} },
		compiler: null,
		log: () => {},
	});
	const context = (clientName = 'Claude') => ({ account, username: 'ada', clientName });
	const call = async (name: string, args: Record<string, unknown>, clientName?: string) => {
		const result = await mcp.local.call(name, args, context(clientName));
		return { text: result.content[0].text as string, isError: result.isError as boolean };
	};
	return { doc, mcp, call };
};

const idOf = (text: string, wanted: string) =>
	requestsOf('/main.tex', cleanView(text).text).find((request: { text: string }) => request.text === wanted).id;

describe('requests to assistants, through the connector', () => {
	it('lists the requests for the assistant that asks, and leaves out the others', async () => {
		const { call } = setUp();
		const listed = await call('list_requests', { project: 'p1' });
		expect(listed.isError).toBe(false);
		expect(listed.text).toMatch(/^1 request for you in “Notes”:/);
		expect(listed.text).toContain('/main.tex, line 5, in “Introduction”, for any assistant.');
		expect(listed.text).toContain('Request: Write one sentence on fluids.');
		expect(listed.text).toContain('Left out, for other assistants: 1 for “codex”.');
		const codex = await call('list_requests', { project: 'p1' }, 'Codex');
		expect(codex.text).toMatch(/^2 requests for you/);
	});

	it('answers a request with one suggestion that replaces it, and a note', async () => {
		const { doc, call } = setUp();
		const id = idOf(doc.text, 'Write one sentence on fluids.');
		const answered = await call('answer_request', {
			project: 'p1',
			id,
			answer: 'Fluids flow.',
			note: 'Kept it short.',
		});
		expect(answered.isError).toBe(false);
		expect(answered.text).toMatch(/^Answered the request of \/main\.tex \(line 5\) with a suggestion and a note/);
		// As collaborators read it, the answer in place of the request.
		expect(cleanView(doc.text).text).toContain('Some text. Fluids flow.\n');
		const [review] = scanAll(doc.text).filter((match: { kind: string }) => match.kind === 'review');
		expect(review.openTagContent).toContain(
			`original: '${Buffer.from('\\prompt{Write one sentence on fluids.}').toString('base64')}'`,
		);
		expect(review.openTagContent).toMatch(/user: Claude \(ada\)/);
		expect(review.openTagContent).toMatch(/responses: \[<#### response/);
		// Answered, it is no longer listed.
		expect((await call('list_requests', { project: 'p1' })).text).toMatch(/^No request for you/);
	});

	it('refuses to answer a request for another assistant, or one that is gone', async () => {
		const { doc, call } = setUp();
		const codex = await call('answer_request', { project: 'p1', id: idOf(doc.text, 'For another assistant.'), answer: 'x' });
		expect(codex.isError).toBe(true);
		expect(codex.text).toMatch(/is for “codex”, not for you/);
		const gone = await call('answer_request', { project: 'p1', id: 'nope', answer: 'x' });
		expect(gone.isError).toBe(true);
		expect(gone.text).toMatch(/Call list_requests again/);
	});

	it('tells when the project does not load feuillet.sty, or has its own \\prompt', async () => {
		const { call } = setUp('\\newcommand{\\prompt}[1]{#1}\n\\prompt{a shell}\n\\feuilletprompt{Do this.}');
		const listed = await call('list_requests', { project: 'p1' });
		expect(listed.text).toMatch(/^1 request for you/);
		expect(listed.text).toContain('Request: Do this.');
		expect(listed.text).toContain('defines a \\prompt of its own');
		expect(listed.text).toContain('does not load feuillet.sty');
	});
});

describe('requests to assistants, answered through the API', () => {
	// A stand-in for Anthropic's client: the replies it is given, in turn.
	class AuthenticationError extends Error {}
	const Anthropic = {
		AuthenticationError,
		PermissionDeniedError: class extends Error {},
		NotFoundError: class extends Error {},
		RateLimitError: class extends Error {},
		APIError: class extends Error {},
	};
	const scripted = (replies: Array<unknown | (() => unknown)>, sent: unknown[]) => () => ({
		Anthropic,
		client: {
			beta: {
				messages: {
					stream: (params: { messages: unknown[] }) => {
						sent.push(structuredClone(params));
						const next = replies.shift();
						return {
							finalMessage: async () => {
								if (next instanceof Error) throw next;
								return typeof next === 'function' ? next() : next;
							},
						};
					},
				},
			},
		},
	});

	const serve = async (runner: { handle: (req: http.IncomingMessage, res: http.ServerResponse, url: string) => void }) => {
		const server = http.createServer((req, res) => runner.handle(req, res, (req.url ?? '').split('?')[0]));
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const request = async (method: string, path: string, body?: unknown) => {
			const response = await fetch(`${base}${path}`, {
				method,
				headers: body ? { 'Content-Type': 'application/json' } : {},
				body: body ? JSON.stringify(body) : undefined,
			});
			return { status: response.status, json: await response.json() };
		};
		return { server, request };
	};
	const accounts = { identify: async () => 'a1', accountById: () => account };
	const waitFor = async (request: (method: string, path: string) => Promise<{ json: { state: string } }>, id: string) => {
		for (let tries = 0; tries < 100; tries++) {
			const { json } = await request('GET', `/prompts/run?id=${id}`);
			if (json.state !== 'running') return json;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error('the run did not end');
	};

	it('lists the requests, then answers them with the tools, on that project alone', async () => {
		const { doc, mcp } = setUp();
		const id = idOf(doc.text, 'Write one sentence on fluids.');
		const sent: Array<{ model: string; tools: Array<{ name: string }>; system: string; fallbacks?: string; betas?: string[] }> = [];
		const runner = createPromptRunner({
			accounts,
			connector: mcp.local,
			log: () => {},
			makeClient: scripted(
				[
					{
						stop_reason: 'tool_use',
						content: [{ type: 'tool_use', id: 't1', name: 'list_requests', input: { project: 'elsewhere' } }],
						usage: { input_tokens: 100, output_tokens: 10 },
					},
					{
						stop_reason: 'tool_use',
						content: [
							{ type: 'text', text: 'Answering.' },
							{ type: 'tool_use', id: 't2', name: 'answer_request', input: { project: 'p2', id, answer: 'Fluids flow.' } },
						],
						usage: { input_tokens: 20, cache_read_input_tokens: 100, output_tokens: 10 },
					},
					{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Answered one request.' }], usage: { input_tokens: 5, output_tokens: 5 } },
				],
				sent,
			),
		});
		const { server, request } = await serve(runner);
		try {
			const listed = await request('GET', '/prompts/requests?project=p1');
			expect(listed.json.requests.map((entry: { text: string; agent: string }) => [entry.text, entry.agent])).toEqual([
				['Write one sentence on fluids.', ''],
				['For another assistant.', 'codex'],
			]);
			const started = await request('POST', '/prompts/run', { project: 'p1', key: 'sk-ant-api03-0123456789abcdef' });
			expect(started.status).toBe(202);
			const run = await waitFor(request, started.json.run);
			expect(run).toEqual(
				expect.objectContaining({
					state: 'done',
					model: 'claude-opus-5-5',
					requests: 1,
					answered: 1,
					turns: 3,
					tokens: { input: 225, output: 25 },
					summary: 'Answered one request.',
				}),
			);
			expect(cleanView(doc.text).text).toContain('Some text. Fluids flow.\n');
			// The tools of the connector, the system prompt naming the project,
			// fallbacks on, and the tool results sent back.
			expect(sent[0].tools.map((tool) => tool.name)).toEqual(
				expect.arrayContaining(['list_requests', 'answer_request', 'read_file', 'compile']),
			);
			expect(sent[0].system).toContain('(id p1)');
			expect(sent[0].fallbacks).toBe('default');
			expect(sent[0].betas).toEqual(['server-side-fallback-2026-07-01']);
			const second = sent[1] as unknown as { messages: Array<{ role: string; content: Array<{ type: string; content?: string }> }> };
			expect(second.messages[2].content[0]).toEqual(
				expect.objectContaining({ type: 'tool_result', content: expect.stringMatching(/^1 request for you in “Notes”/) }),
			);
			// Nothing left for this run's assistant.
			expect((await request('POST', '/prompts/run', { project: 'p1', key: 'sk-ant-api03-0123456789abcdef' })).json).toEqual({ run: null });
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it('says a refused key in its own words, and checks what it is given', async () => {
		const { mcp } = setUp();
		const runner = createPromptRunner({
			accounts,
			connector: mcp.local,
			log: () => {},
			makeClient: scripted([new AuthenticationError('invalid x-api-key')], []),
		});
		const { server, request } = await serve(runner);
		try {
			expect((await request('POST', '/prompts/run', { project: 'p1', key: 'short' })).json).toEqual({ error: 'invalid_key' });
			expect(
				(await request('POST', '/prompts/run', { project: 'p1', key: 'sk-ant-api03-0123456789abcdef', model: 'gpt' })).json,
			).toEqual({ error: 'unknown_model' });
			expect((await request('POST', '/prompts/run', { project: 'p9', key: 'sk-ant-api03-0123456789abcdef' })).status).toBe(404);
			const started = await request('POST', '/prompts/run', {
				project: 'p1',
				key: 'sk-ant-api03-0123456789abcdef',
				model: 'claude-haiku-5-5',
			});
			const run = await waitFor(request, started.json.run);
			expect(run).toEqual(expect.objectContaining({ state: 'failed', error: { code: 'invalid_key' }, answered: 0 }));
			expect(JSON.stringify(run)).not.toContain('sk-ant');
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it('sends back no thinking nor tool call from before a fallback', () => {
		const content = [
			{ type: 'thinking', thinking: '' },
			{ type: 'tool_use', id: 'x' },
			{ type: 'text', text: 'partial' },
			{ type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
			{ type: 'thinking', thinking: '' },
			{ type: 'tool_use', id: 'y' },
		];
		expect(echoed(content).map((block: { type: string }) => block.type)).toEqual([
			'text',
			'fallback',
			'thinking',
			'tool_use',
		]);
	});
});
