// A server keeping a project's files between connections: on a new one,
// the page sends the list first, then only what the server lacks.
import { createHash } from 'node:crypto';

type Handler = (payload: string) => void;
const sent: Array<Record<string, unknown>> = [];
let serverHas = new Set<string>();
let answerMissingList = true;

const transport = {
	isOpen: true,
	handlers: [] as Handler[],
	send(payload: string) {
		const request = JSON.parse(payload);
		sent.push(request);
		const files = new Set((request.files ?? []).map((file: { path: string }) => file.path));
		const missing = (request.manifest ?? [])
			.map((entry: { path: string }) => entry.path)
			.filter((path: string) => !files.has(path) && !serverHas.has(path));
		for (const path of files) serverHas.add(path as string);
		const reply =
			missing.length > 0
				? { requestId: request.requestId, status: -2, log: '', format: 'pdf', ...(answerMissingList ? { missing } : {}) }
				: { requestId: request.requestId, status: 0, log: 'ok', format: 'pdf' };
		queueMicrotask(() => {
			for (const handler of transport.handlers) handler(JSON.stringify(reply));
		});
	},
	close: jest.fn(),
	onMessage(handler: Handler) {
		transport.handlers.push(handler);
		return () => undefined;
	},
	onClose: () => () => undefined,
	onError: () => () => undefined,
};

jest.mock('@chelys/peer/TransportFactory', () => ({
	openTransport: jest.fn(async () => transport),
}));

import { genericTypesetterService } from '../../src/services/GenericTypesetterService';

const file = (path: string, text: string) => ({
	path,
	content: Uint8Array.from(new TextEncoder().encode(text)),
	lastModified: 1,
});
const files = [file('main.tex', '\\documentclass{article}'), file('chapitre.tex', 'Chapitre.')];
const paths = (request: Record<string, unknown>) =>
	((request.files as Array<{ path: string }>) ?? []).map((entry) => entry.path).sort();

let id = 0;
const register = () => {
	const configId = `texlive-test-${++id}`;
	genericTypesetterService.registerConfig({
		id: configId,
		name: 'TeX Live',
		projectType: 'latex',
		incrementalSync: true,
		transportConfig: { type: 'websocket', url: 'ws://test/' },
	} as never);
	return configId;
};

describe('a server keeping the project files', () => {
	beforeEach(() => {
		// The real SHA-256: the test setup stubs it.
		(global.crypto.subtle.digest as jest.Mock).mockImplementation(
			async (_algorithm: AlgorithmIdentifier, data: BufferSource) => {
				const bytes =
					data instanceof ArrayBuffer
						? new Uint8Array(data)
						: new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
				const hash = createHash('sha256').update(bytes).digest();
				return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
			},
		);
		sent.length = 0;
		transport.handlers = [];
		answerMissingList = true;
	});

	it('sends the list first, then only the files the server lacks', async () => {
		serverHas = new Set(['chapitre.tex']);
		const configId = register();

		const result = await genericTypesetterService.compile(configId, {
			mainFile: 'main.tex',
			format: 'pdf',
			files,
			cacheScope: 'projet-a',
		});

		expect(result.status).toBe(0);
		expect(sent).toHaveLength(2);
		expect(paths(sent[0])).toEqual([]);
		expect(sent[0].cacheScope).toBe('projet-a');
		expect((sent[0].manifest as unknown[]).length).toBe(2);
		expect(paths(sent[1])).toEqual(['main.tex']);
	});

	it('then sends only what changed, as before', async () => {
		serverHas = new Set();
		const configId = register();
		await genericTypesetterService.compile(configId, {
			mainFile: 'main.tex',
			format: 'pdf',
			files,
			cacheScope: 'projet-a',
		});
		sent.length = 0;

		await genericTypesetterService.compile(configId, {
			mainFile: 'main.tex',
			format: 'pdf',
			files: [files[0], { ...file('chapitre.tex', 'Chapitre changé.'), lastModified: 2 }],
			cacheScope: 'projet-a',
		});

		expect(sent).toHaveLength(1);
		expect(paths(sent[0])).toEqual(['chapitre.tex']);
	});

	it('sends everything at once without a project to keep files for', async () => {
		serverHas = new Set();
		const configId = register();

		await genericTypesetterService.compile(configId, {
			mainFile: 'main.tex',
			format: 'pdf',
			files,
		});

		expect(sent).toHaveLength(1);
		expect(paths(sent[0])).toEqual(['chapitre.tex', 'main.tex']);
	});

	it('sends everything to a server that does not tell which files it lacks', async () => {
		serverHas = new Set(['chapitre.tex']);
		answerMissingList = false;
		const configId = register();

		const result = await genericTypesetterService.compile(configId, {
			mainFile: 'main.tex',
			format: 'pdf',
			files,
			cacheScope: 'projet-a',
		});

		expect(result.status).toBe(0);
		expect(paths(sent[1])).toEqual(['chapitre.tex', 'main.tex']);
	});
});
