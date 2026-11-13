/**
 * @jest-environment node
 */
// The assistant connector (server/collab/mcp.js) in both eras of the Model
// Context Protocol: 2026-07-28, where every request carries its version,
// method and tool in headers that must agree with its body, and the
// versions before it, which begin with initialize. A client asking for a
// version not here is told those that are, to pick from rather than give
// up. The real module over HTTP, with a signed-in account and no projects.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const { createMcp } = require('../../../server/collab/mcp.js');

const MODERN = '2026-07-28';
const meta = (version = MODERN) => ({
	'io.modelcontextprotocol/protocolVersion': version,
	'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0.0' },
	'io.modelcontextprotocol/clientCapabilities': {},
});

describe('the assistant connector, in both eras of the protocol', () => {
	let server: http.Server;
	let url: string;

	beforeAll(async () => {
		const mcp = createMcp({
			oauth: {
				authenticate: () => ({
					grant: { clientName: 'Claude' },
					account: { id: 'a1', username: 'ada', projects: [] },
				}),
				challenge: () => 'Bearer',
			},
			shares: { accessOf: () => null },
			files: {},
			history: {},
			compiler: {},
			log: () => {},
			version: '9.9.9',
		});
		server = http.createServer((req, res) => void mcp.handle(req, res));
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
	});

	afterAll(() => new Promise((resolve) => server.close(resolve)));

	const post = async (body: unknown, headers: Record<string, string> = {}) => {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				...headers,
			},
			body: JSON.stringify(body),
		});
		const text = await response.text();
		return { status: response.status, json: text ? JSON.parse(text) : undefined };
	};
	const modern = (
		id: number,
		method: string,
		params: Record<string, unknown> = {},
		headers: Record<string, string> = {},
	) =>
		post(
			{ jsonrpc: '2.0', id, method, params: { _meta: meta(), ...params } },
			{ 'MCP-Protocol-Version': MODERN, 'Mcp-Method': method, ...headers },
		);

	describe('2026-07-28', () => {
		it('says what the server is and can do, to server/discover', async () => {
			const { status, json } = await modern(1, 'server/discover');
			expect(status).toBe(200);
			expect(json.id).toBe(1);
			expect(json.result).toEqual(
				expect.objectContaining({
					resultType: 'complete',
					supportedVersions: expect.arrayContaining([MODERN, '2025-11-25', '2024-11-05']),
					capabilities: { tools: {} },
					instructions: expect.stringContaining('Feuillet'),
					ttlMs: expect.any(Number),
					cacheScope: 'public',
				}),
			);
			expect(json.result._meta['io.modelcontextprotocol/serverInfo']).toEqual(
				expect.objectContaining({ name: 'feuillet', version: '9.9.9' }),
			);
		});

		it('lists the tools, for any account alike', async () => {
			const { status, json } = await modern(2, 'tools/list');
			expect(status).toBe(200);
			expect(json.result.resultType).toBe('complete');
			expect(json.result.cacheScope).toBe('public');
			expect(json.result.ttlMs).toBeGreaterThan(0);
			const names = json.result.tools.map((tool: { name: string }) => tool.name);
			expect(names).toEqual(expect.arrayContaining(['list_projects', 'read_file', 'compile']));
			// What runs a tool stays here.
			expect(json.result.tools[0].run).toBeUndefined();
		});

		it('calls a tool named in Mcp-Name, plainly or in Base64', async () => {
			const plain = await modern(3, 'tools/call', { name: 'list_projects', arguments: {} }, {
				'Mcp-Name': 'list_projects',
			});
			expect(plain.status).toBe(200);
			expect(plain.json.result).toEqual(
				expect.objectContaining({ resultType: 'complete', isError: false }),
			);
			expect(plain.json.result.content[0].text).toMatch(/no projects/);
			const encoded = await modern(4, 'tools/call', { name: 'list_projects', arguments: {} }, {
				'Mcp-Name': `=?base64?${Buffer.from('list_projects', 'utf8').toString('base64')}?=`,
			});
			expect(encoded.status).toBe(200);
			expect(encoded.json.result.isError).toBe(false);
		});

		it('refuses headers that disagree with the body, or are missing', async () => {
			const method = await modern(5, 'tools/list', {}, { 'Mcp-Method': 'tools/call' });
			expect(method.status).toBe(400);
			expect(method.json.error.code).toBe(-32020);
			expect(method.json.id).toBe(5);
			const name = await modern(6, 'tools/call', { name: 'list_projects' }, { 'Mcp-Name': 'read_file' });
			expect(name.status).toBe(400);
			expect(name.json.error.code).toBe(-32020);
			const noName = await modern(7, 'tools/call', { name: 'list_projects' });
			expect(noName.status).toBe(400);
			expect(noName.json.error).toEqual(
				expect.objectContaining({ code: -32020, message: expect.stringMatching(/Mcp-Name header is missing/) }),
			);
			const version = await post(
				{ jsonrpc: '2.0', id: 8, method: 'tools/list', params: { _meta: meta('2025-11-25') } },
				{ 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' },
			);
			expect(version.status).toBe(400);
			expect(version.json.error.code).toBe(-32020);
		});

		it('asks for the version and the capabilities in _meta', async () => {
			const headers = { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' };
			const noMeta = await post({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, headers);
			expect(noMeta.status).toBe(400);
			expect(noMeta.json.error.code).toBe(-32602);
			const { 'io.modelcontextprotocol/clientCapabilities': _, ...partial } = meta();
			const noCapabilities = await post(
				{ jsonrpc: '2.0', id: 10, method: 'tools/list', params: { _meta: partial } },
				headers,
			);
			expect(noCapabilities.status).toBe(400);
			expect(noCapabilities.json.error.code).toBe(-32602);
		});

		it('answers 404 to what it does not do, ping included', async () => {
			for (const method of ['ping', 'resources/list']) {
				const { status, json } = await modern(11, method);
				expect(status).toBe(404);
				expect(json.error.code).toBe(-32601);
			}
		});

		it('refuses an unknown tool, and accepts notifications without answering', async () => {
			const unknown = await modern(12, 'tools/call', { name: 'nope' }, { 'Mcp-Name': 'nope' });
			expect(unknown.status).toBe(400);
			expect(unknown.json.error.code).toBe(-32602);
			const notification = await post(
				{ jsonrpc: '2.0', method: 'notifications/cancelled', params: { _meta: meta() } },
				{ 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'notifications/cancelled' },
			);
			expect(notification.status).toBe(202);
			expect(notification.json).toBeUndefined();
		});

		it('takes one message per request', async () => {
			const { status, json } = await post(
				[{ jsonrpc: '2.0', id: 13, method: 'tools/list', params: { _meta: meta() } }],
				{ 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' },
			);
			expect(status).toBe(400);
			expect(json.error.code).toBe(-32600);
		});
	});

	describe('a version not here', () => {
		it('is answered with the versions here, which a client recognizes', async () => {
			const { status, json } = await post(
				{ jsonrpc: '2.0', id: 14, method: 'tools/list', params: { _meta: meta('2099-01-01') } },
				{ 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' },
			);
			expect(status).toBe(400);
			expect(json).toEqual({
				jsonrpc: '2.0',
				id: 14,
				error: {
					code: -32022,
					message: 'Unsupported protocol version',
					data: {
						supported: [MODERN, '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
						requested: '2099-01-01',
					},
				},
			});
		});
	});

	describe('the versions that begin with initialize', () => {
		it('agrees on a version, whatever the header of initialize says', async () => {
			for (const header of [undefined, MODERN, '2099-01-01']) {
				const { status, json } = await post(
					{
						jsonrpc: '2.0',
						id: 1,
						method: 'initialize',
						params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
					},
					header ? { 'MCP-Protocol-Version': header } : {},
				);
				expect(status).toBe(200);
				expect(json.result).toEqual(
					expect.objectContaining({
						protocolVersion: '2025-06-18',
						capabilities: { tools: { listChanged: false } },
						serverInfo: expect.objectContaining({ name: 'feuillet' }),
					}),
				);
			}
			const newest = await post({
				jsonrpc: '2.0',
				id: 2,
				method: 'initialize',
				params: { protocolVersion: '2099-01-01', capabilities: {} },
			});
			expect(newest.json.result.protocolVersion).toBe('2025-11-25');
		});

		it('then works as before, without resultType nor headers to agree', async () => {
			const headers = { 'MCP-Protocol-Version': '2025-11-25' };
			const initialized = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, headers);
			expect(initialized.status).toBe(202);
			const ping = await post({ jsonrpc: '2.0', id: 3, method: 'ping' }, headers);
			expect(ping.json).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
			const list = await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, headers);
			expect(list.status).toBe(200);
			expect(list.json.result.resultType).toBeUndefined();
			expect(list.json.result.tools.length).toBeGreaterThan(5);
			const call = await post(
				{ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_projects', arguments: {} } },
				headers,
			);
			expect(call.json.result).toEqual(
				expect.objectContaining({ isError: false, content: [expect.objectContaining({ type: 'text' })] }),
			);
			// Without the header, as before 2025-06-18; and in a batch.
			const batch = await post([
				{ jsonrpc: '2.0', id: 6, method: 'ping' },
				{ jsonrpc: '2.0', id: 7, method: 'tools/list' },
			]);
			expect(batch.json.map((reply: { id: number }) => reply.id)).toEqual([6, 7]);
		});
	});
});
