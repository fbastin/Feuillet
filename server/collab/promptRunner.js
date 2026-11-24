// server/collab/promptRunner.js
// Requests to assistants (prompts.js) answered from Feuillet itself, by
// Claude through Anthropic's API, rather than by an assistant connected
// from elsewhere (mcp.js). The account brings its own API key, which its
// browser keeps encrypted, as it does Git tokens: the server is given it
// for one run, uses it for that run's calls alone, and keeps it nowhere,
// not even in its logs. The calls are billed to that key's account.
//
// Claude works with the connector's tools, as the account and with its role,
// on the one project the run is for: whatever project a call names, it is
// that one. Its answers are suggestions that replace the requests, which
// the project's people accept or reject.
//
//   GET  /prompts/requests?project=ID  -> {project, requests: [{id, path,
//        line, agent, text}], ownPrompt, loads}
//   POST /prompts/run {project, key, model?, name?}
//        -> 202 {run} (or 200 {run: null} when no request is for it)
//   GET  /prompts/run?id=RUN  -> the run: {id, state (running, done,
//        stopped, failed), requests, answered, turns, tokens, error?}
//   POST /prompts/run/stop {id}
//
// The account is the one signed in (accounts.identify); a run is seen and
// stopped by its account only, and forgotten an hour after it ends.

const crypto = require('node:crypto');

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const DEFAULT_MODEL = 'claude-opus-5-5';
// Models whose refusals another model may take over (fallbacks: 'default').
const WITH_FALLBACKS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const TOOLS = [
	'list_requests',
	'answer_request',
	'list_files',
	'read_file',
	'search',
	'list_review',
	'edit_file',
	'add_comment',
	'compile',
];
const MAX_TURNS = 60;
const MAX_TOKENS = 32000;
const KEEP_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

const defaultClient = (key) => {
	const sdk = require('@anthropic-ai/sdk');
	const Anthropic = sdk.default ?? sdk;
	return { client: new Anthropic({ apiKey: key, maxRetries: 2 }), Anthropic };
};

/**
 * After a fallback in the middle of a reply, what goes back: no thinking
 * nor tool call from before the last switch (the model that made them
 * declined), the switch itself kept where it was.
 */
const echoed = (content) => {
	const last = content.map((block) => block.type).lastIndexOf('fallback');
	if (last === -1) return content;
	const dropped = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);
	return content.filter((block, index) => index >= last || !dropped.has(block.type));
};

const systemPrompt = (project, instructions) =>
	[
		instructions,
		'',
		`You are working in Feuillet on the project ${JSON.stringify(project.name)} (id ${project.id}), and on it alone: every tool works on this project, whatever project it is given.`,
		'Its people have written requests for you in its LaTeX files, as \\prompt{…}. Call list_requests, then answer each request with answer_request. Read the file around a request first when the answer depends on it, write in the language and the style of the document, and give LaTeX that compiles where the request stands: the answer replaces the request, as a suggestion that its people accept or reject.',
		"When a request asks a question rather than for text, answer it in answer_request's note, with an empty answer. When a request needs a change elsewhere, such as a package in the preamble, suggest it with edit_file too. When you cannot answer a request, say why in a note and leave its answer empty.",
		'Finish with one short sentence on what you did.',
	].join('\n');

const createPromptRunner = ({ accounts, connector, log, makeClient = defaultClient, now = Date.now }) => {
	const runs = new Map();

	const prune = () => {
		for (const [id, run] of runs) {
			if (run.endedAt && now() - run.endedAt > KEEP_MS) runs.delete(id);
		}
	};

	const accountOf = async (req) => {
		const id = await accounts.identify(req);
		const account = accounts.accountById(id);
		if (!account) throw new HttpError(401, 'signed_out');
		return account;
	};

	const view = (run) => ({
		id: run.id,
		project: run.project.id,
		state: run.state,
		model: run.model,
		requests: run.requests,
		answered: run.answered,
		turns: run.turns,
		tokens: run.tokens,
		startedAt: run.startedAt,
		...(run.endedAt ? { endedAt: run.endedAt } : {}),
		...(run.summary ? { summary: run.summary } : {}),
		...(run.error ? { error: run.error } : {}),
	});

	// What went wrong, for the person: the API's own words for its errors,
	// never the key.
	const failure = (error, Anthropic) => {
		if (Anthropic && error instanceof Anthropic.AuthenticationError) return { code: 'invalid_key' };
		if (Anthropic && error instanceof Anthropic.PermissionDeniedError) return { code: 'not_allowed' };
		if (Anthropic && error instanceof Anthropic.NotFoundError) return { code: 'unknown_model' };
		if (Anthropic && error instanceof Anthropic.RateLimitError) return { code: 'rate_limited' };
		if (Anthropic && error instanceof Anthropic.APIError) {
			return {
				code: 'api_error',
				status: error.status ?? null,
				message: String(error.error?.error?.message ?? error.message ?? '').slice(0, 500),
			};
		}
		return { code: 'server_error' };
	};

	const execute = async (run, key) => {
		let Anthropic = null;
		try {
			const made = makeClient(key);
			const { client } = made;
			Anthropic = made.Anthropic;
			const tools = connector.definitions(TOOLS).map((tool) => ({
				name: tool.name,
				description: tool.description,
				input_schema: tool.inputSchema,
			}));
			const system = systemPrompt(run.project, connector.instructions);
			const messages = [
				{
					role: 'user',
					content: `Answer the requests for you in the project ${JSON.stringify(run.project.name)} (id ${run.project.id}).`,
				},
			];
			const fallbacks = WITH_FALLBACKS.has(run.model);
			while (true) {
				if (run.stopping) {
					run.state = 'stopped';
					break;
				}
				if (run.turns >= MAX_TURNS) {
					run.state = 'stopped';
					run.error = { code: 'too_many_turns' };
					break;
				}
				run.turns++;
				const stream = client.beta.messages.stream(
					{
						model: run.model,
						max_tokens: MAX_TOKENS,
						system,
						tools,
						messages,
						// The conversation grows by its end only: each turn reads
						// the turns before it from the cache.
						cache_control: { type: 'ephemeral' },
						output_config: { effort: 'high' },
						...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
					},
					{ signal: run.abort.signal },
				);
				const message = await stream.finalMessage();
				const usage = message.usage ?? {};
				run.tokens.input +=
					(usage.input_tokens ?? 0) +
					(usage.cache_read_input_tokens ?? 0) +
					(usage.cache_creation_input_tokens ?? 0);
				run.tokens.output += usage.output_tokens ?? 0;
				if (message.stop_reason === 'refusal') {
					run.state = 'failed';
					run.error = { code: 'refused', category: message.stop_details?.category ?? null };
					break;
				}
				const calls = message.content.filter((block) => block.type === 'tool_use');
				if (message.stop_reason === 'max_tokens') {
					run.state = 'failed';
					run.error = { code: 'too_long' };
					break;
				}
				if (message.stop_reason !== 'tool_use' || !calls.length) {
					run.summary = message.content
						.filter((block) => block.type === 'text')
						.map((block) => block.text)
						.join('\n')
						.trim()
						.slice(0, 2000);
					run.state = 'done';
					break;
				}
				messages.push({ role: 'assistant', content: echoed(message.content) });
				const results = [];
				for (const call of calls) {
					const args = call.input && typeof call.input === 'object' ? { ...call.input } : {};
					// This project, whatever the call says; suggestions only.
					args.project = run.project.id;
					if (call.name === 'edit_file') args.mode = 'suggest';
					const outcome = TOOLS.includes(call.name)
						? await connector.call(call.name, args, run.context)
						: { content: [{ type: 'text', text: `Unknown tool: ${call.name}` }], isError: true };
					if (call.name === 'answer_request' && !outcome.isError) run.answered++;
					results.push({
						type: 'tool_result',
						tool_use_id: call.id,
						content: outcome.content.map((block) => block.text).join('\n'),
						...(outcome.isError ? { is_error: true } : {}),
					});
				}
				messages.push({ role: 'user', content: results });
			}
		} catch (error) {
			if (run.stopping) {
				run.state = 'stopped';
			} else {
				run.state = 'failed';
				run.error = failure(error, Anthropic);
				if (run.error.code === 'server_error') log('assistant run failed', error?.message ?? error);
			}
		} finally {
			run.endedAt = now();
		}
	};

	const requestsFor = async (account, projectRef) => {
		const found = await connector.pendingRequests(account, projectRef);
		if (!found) throw new HttpError(404, 'no_project');
		return found;
	};

	const routes = {
		'GET /prompts/requests': async (req, params) => {
			const account = await accountOf(req);
			const found = await requestsFor(account, params.get('project'));
			return {
				project: found.project,
				ownPrompt: found.ownPrompt,
				loads: found.loads,
				requests: found.requests.map(({ id, path: filePath, line, agent, text }) => ({
					id,
					path: filePath,
					line,
					agent,
					text: text.slice(0, 2000),
				})),
			};
		},
		'POST /prompts/run': async (req, _params, body) => {
			const account = await accountOf(req);
			const key = typeof body.key === 'string' ? body.key.trim() : '';
			if (key.length < 20 || key.length > 400 || /\s/.test(key)) throw new HttpError(400, 'invalid_key');
			const model = body.model === undefined ? DEFAULT_MODEL : body.model;
			if (!MODELS.includes(model)) throw new HttpError(400, 'unknown_model');
			const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Claude';
			const found = await requestsFor(account, body.project);
			if (found.project.access === 'view') throw new HttpError(403, 'read_only');
			const clientName = `${name} (API)`;
			const mine = found.requests.filter((request) => connector.agentMatches(request.agent, clientName));
			if (!mine.length) return [200, { run: null }];
			prune();
			for (const run of runs.values()) {
				if (run.account === account.id && run.project.id === found.project.id && run.state === 'running') {
					throw new HttpError(409, 'already_running');
				}
			}
			const run = {
				id: crypto.randomBytes(12).toString('base64url'),
				account: account.id,
				project: found.project,
				model,
				context: { account, username: account.username, clientName },
				state: 'running',
				requests: mine.length,
				answered: 0,
				turns: 0,
				tokens: { input: 0, output: 0 },
				startedAt: now(),
				abort: new AbortController(),
				stopping: false,
			};
			runs.set(run.id, run);
			log('assistant run started', run.id, model);
			void execute(run, key).then(() => log('assistant run ended', run.id, run.state, run.answered));
			return [202, { run: run.id }];
		},
		'GET /prompts/run': async (req, params) => {
			const account = await accountOf(req);
			const run = runs.get(String(params.get('id') ?? ''));
			if (!run || run.account !== account.id) throw new HttpError(404, 'no_run');
			return view(run);
		},
		'POST /prompts/run/stop': async (req, _params, body) => {
			const account = await accountOf(req);
			const run = runs.get(String(body.id ?? ''));
			if (!run || run.account !== account.id) throw new HttpError(404, 'no_run');
			if (run.state === 'running') {
				run.stopping = true;
				run.abort.abort();
			}
			return view(run);
		},
	};

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			let size = 0;
			const chunks = [];
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					reject(new HttpError(413, 'too_large'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
					resolve(value && typeof value === 'object' ? value : {});
				} catch {
					reject(new HttpError(400, 'invalid_json'));
				}
			});
			req.on('error', () => reject(new HttpError(400, 'interrupted')));
		});

	const handles = (url) => url === '/prompts/requests' || url === '/prompts/run' || url === '/prompts/run/stop';

	const handle = async (req, res, url) => {
		const reply = (status, body) => {
			res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
			res.end(JSON.stringify(body));
		};
		const route = routes[`${req.method} ${url}`];
		if (!route) {
			req.resume();
			reply(404, { error: 'not_found' });
			return;
		}
		try {
			const params = new URL(req.url, 'http://localhost').searchParams;
			const body = req.method === 'POST' ? await readBody(req) : {};
			if (req.method !== 'POST') req.resume();
			const outcome = await route(req, params, body);
			if (Array.isArray(outcome)) reply(outcome[0], outcome[1]);
			else reply(200, outcome);
		} catch (error) {
			// Errors from the accounts (signed out...) carry a status too.
			if (Number.isInteger(error?.status) && typeof error.code === 'string') {
				reply(error.status, { error: error.code });
				return;
			}
			log('assistant request failed', error?.message ?? error);
			reply(500, { error: 'server_error' });
		}
	};

	return { handles, handle };
};

module.exports = { createPromptRunner, echoed, MODELS };
