/**
 * @jest-environment node
 */
// Grammar checking (server/collab/grammar.js) against a stand-in for
// LanguageTool: the first check of a language it has not used yet may fail
// with a server error, while it makes its rules; the collaboration server
// asks once more instead of failing. LanguageTool keeps rules for each
// language and list of rules turned off: the server asks for the editor's
// languages only, always with the same list.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SPELLING_LANGUAGES } from '../../../src/types/spelling';
import { grammarLanguageOf } from '../../../src/utils/spellingUtils';

const { createGrammar, LANGUAGES } = require('../../../server/collab/grammar.js');

type Answer = (language: string, seen: number) => number;

const ALWAYS_DISABLED = 'WHITESPACE_RULE,CONSECUTIVE_SPACES,FRENCH_WHITESPACE';

const MATCHES = [
	{
		offset: 4,
		length: 3,
		message: 'Possible agreement error.',
		replacements: [{ value: 'ist' }],
		rule: { id: 'DE_AGREEMENT', category: { id: 'GRAMMAR' } },
	},
	{
		offset: 9,
		length: 3,
		message: 'Consider a shorter word.',
		replacements: [],
		rule: { id: 'TOO_LONG_WORD', category: { id: 'STYLE' } },
	},
	{
		offset: 13,
		length: 9,
		message: 'Possible spelling mistake.',
		replacements: [],
		rule: { id: 'GERMAN_SPELLER_RULE', category: { id: 'TYPOS' } },
	},
];

const listen = (server: http.Server) =>
	new Promise<string>((resolve) =>
		server.listen(0, '127.0.0.1', () =>
			resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
		),
	);

const ruleIds = (body: { matches: { rule: { id: string } }[] }) =>
	body.matches.map((match) => match.rule.id);

describe('grammar', () => {
	let languageTool: http.Server;
	let collab: http.Server;
	let base: string;
	let requests: string[];
	let turnedOff: string[];
	let answer: Answer;

	beforeEach(async () => {
		requests = [];
		turnedOff = [];
		languageTool = http.createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (chunk) => chunks.push(chunk));
			req.on('end', () => {
				const form = new URLSearchParams(Buffer.concat(chunks).toString());
				const language = form.get('language') ?? '';
				requests.push(language);
				turnedOff.push(form.get('disabledRules') ?? '');
				const seen = requests.filter((l) => l === language).length;
				const status = answer(language, seen);
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(status === 200 ? JSON.stringify({ matches: MATCHES }) : '{}');
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

	const check = (language: string, disabledRules?: string[]) =>
		fetch(`${base}/grammar/check`, {
			method: 'POST',
			body: JSON.stringify({
				language,
				annotation: [{ text: 'Das sind ein Beispiel.' }],
				disabledRules,
			}),
		});

	it('asks once more when the first check of a language fails, and answers', async () => {
		answer = (_language, seen) => (seen === 1 ? 500 : 200);
		const response = await check('de-DE');
		expect(response.status).toBe(200);
		const body = await response.json();
		// Spelling is left to Feuillet's own checker.
		expect(ruleIds(body)).toEqual(['DE_AGREEMENT', 'TOO_LONG_WORD']);
		expect(body.matches[0]).toMatchObject({ offset: 4, length: 3, replacements: ['ist'] });
		expect(requests).toEqual(['de-DE', 'de-DE']);
		// Once LanguageTool has the language, a single request.
		expect((await check('de-DE')).status).toBe(200);
		expect(requests).toHaveLength(3);
	});

	it('leaves out the rules the account turned off, asking LanguageTool the same', async () => {
		answer = () => 200;
		expect(ruleIds(await (await check('de-DE')).json())).toEqual([
			'DE_AGREEMENT',
			'TOO_LONG_WORD',
		]);
		expect(ruleIds(await (await check('de-DE', ['TOO_LONG_WORD'])).json())).toEqual([
			'DE_AGREEMENT',
		]);
		expect(turnedOff).toEqual([ALWAYS_DISABLED, ALWAYS_DISABLED]);
		expect((await check('de-DE', ['NOT A RULE'])).status).toBe(400);
		expect(requests).toHaveLength(2);
	});

	it("takes the editor's languages only, without asking LanguageTool for others", async () => {
		answer = () => 200;
		expect([...LANGUAGES].sort()).toEqual(SPELLING_LANGUAGES.map(grammarLanguageOf).sort());
		for (const language of ['uk-UA', 'sk-SK', 'de-AT', 'auto', 'xx']) {
			const response = await check(language);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: 'invalid_language' });
		}
		expect(requests).toEqual([]);
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
		const response = await check('nl');
		expect(response.status).toBe(502);
		expect(requests).toEqual(['nl']);
	});
});
