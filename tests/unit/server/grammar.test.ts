/**
 * @jest-environment node
 */
// Grammar checking (server/collab/grammar.js) against a stand-in for
// LanguageTool: the first check of a language it has not used yet may fail
// with a server error, while it makes its rules; the collaboration server
// asks once more instead of failing.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const { createGrammar } = require('../../../server/collab/grammar.js');

type Answer = (language: string, seen: number) => number;

const listen = (server: http.Server) =>
	new Promise<string>((resolve) =>
		server.listen(0, '127.0.0.1', () =>
			resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
		),
	);

describe('grammar', () => {
	let languageTool: http.Server;
	let collab: http.Server;
	let base: string;
	let requests: string[];
	let answer: Answer;

	beforeEach(async () => {
		requests = [];
		languageTool = http.createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (chunk) => chunks.push(chunk));
			req.on('end', () => {
				const language =
					new URLSearchParams(Buffer.concat(chunks).toString()).get('language') ?? '';
				requests.push(language);
				const seen = requests.filter((l) => l === language).length;
				const status = answer(language, seen);
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(
					status === 200
						? JSON.stringify({
								matches: [
									{
										offset: 4,
										length: 3,
										message: 'Possible agreement error.',
										replacements: [{ value: 'ist' }],
										rule: { id: 'DE_AGREEMENT', category: { id: 'GRAMMAR' } },
									},
								],
							})
						: '{}',
				);
			});
		});
		const grammar = createGrammar({
			accounts: { identify: async () => 'account' },
			url: await listen(languageTool),
			retryDelayMs: 10,
		});
		collab = http.createServer((req, res) =>
			grammar.handle(req, res, new URL(req.url ?? '/', 'http://x').pathname),
		);
		base = await listen(collab);
	});

	afterEach(async () => {
		await new Promise((resolve) => collab.close(resolve));
		await new Promise((resolve) => languageTool.close(resolve));
	});

	const check = (language: string) =>
		fetch(`${base}/grammar/check`, {
			method: 'POST',
			body: JSON.stringify({ language, annotation: [{ text: 'Das sind ein Beispiel.' }] }),
		});

	it('asks once more when the first check of a language fails, and answers', async () => {
		answer = (_language, seen) => (seen === 1 ? 500 : 200);
		const response = await check('de-AT');
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.matches).toHaveLength(1);
		expect(body.matches[0]).toMatchObject({ offset: 4, length: 3, replacements: ['ist'] });
		expect(requests).toEqual(['de-AT', 'de-AT']);
		// Once LanguageTool has the language, a single request.
		expect((await check('de-AT')).status).toBe(200);
		expect(requests).toHaveLength(3);
	});

	it('gives up after the second failure', async () => {
		answer = () => 503;
		const response = await check('sv');
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: 'grammar_failed' });
		expect(requests).toEqual(['sv', 'sv']);
	});

	it('does not ask again what LanguageTool refuses', async () => {
		answer = () => 400;
		const response = await check('xx');
		expect(response.status).toBe(502);
		expect(requests).toEqual(['xx']);
	});
});
