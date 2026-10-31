import { accountSyncService } from '@src/services/AccountSyncService';
import { authService } from '@src/services/AuthService';
import { fileImportService } from '@src/services/FileImportService';
import { fileStoreService } from '@src/services/FileStoreService';
import { genericTypesetterService } from '@src/services/GenericTypesetterService';
import { typesetterRegistryService } from '@src/services/TypesetterRegistryService';
import type { FileNode } from '@src/types/files';
import type { Project } from '@src/types/projects';
import { createTexliveTypesetterConfig } from '@src/utils/texliveTypesetter';

// Documents stored on this device, by IndexedDB name: a document's text, or
// a project's settings.
const documents = new Map<string, unknown>();
jest.mock('y-indexeddb', () => ({
	IndexeddbPersistence: class {
		whenSynced: Promise<void>;
		constructor(name: string, doc: import('yjs').Doc) {
			const stored = documents.get(name);
			if (typeof stored === 'string') doc.getText('codemirror').insert(0, stored);
			else if (stored) doc.getMap('data').set('projectMetadata', stored);
			this.whenSynced = Promise.resolve();
		}
		async destroy() {}
	},
}));

const file = (
	path: string,
	content: string,
	extra: Partial<FileNode> = {},
): FileNode => ({
	id: `id-${path}`,
	name: path.split('/').pop() ?? path,
	path,
	type: 'file',
	content,
	lastModified: 1,
	...extra,
});

const project = (id: string): Project => ({
	id: `project-${id}`,
	name: id,
	description: '',
	type: 'latex',
	docUrl: `yjs:${id}`,
	createdAt: 1,
	updatedAt: 1,
	ownerId: 'user',
	tags: [],
	isFavorite: false,
});

const text = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('utf8');

const response = (status: number, body: string | object) => ({
	ok: status >= 200 && status < 300,
	status,
	arrayBuffer: async () => Uint8Array.from(Buffer.from(String(body))).buffer,
	json: async () => body,
});

describe('files from another project', () => {
	const stored = [
		file('/refs.bib', '@book{knuth}'),
		file('/main.tex', 'old text', { documentId: 'doc1' }),
		file('/figures/plot.png', 'PNG'),
		file('/.texlyre_src/__output/main.pdf', '%PDF'),
	];

	beforeEach(() => {
		jest
			.spyOn(fileStoreService, 'getProjectFiles')
			.mockImplementation(async (projectId) =>
				projectId === 'source'
					? stored.map(({ content, ...rest }) => rest as FileNode)
					: [],
			);
		jest
			.spyOn(fileStoreService, 'getProjectFile')
			.mockImplementation(async (projectId, fileId) =>
				projectId === 'source'
					? stored.find((entry) => entry.id === fileId)
					: undefined,
			);
		documents.set('texlyre-project-source-yjs_doc1', 'text from the document');
	});
	afterEach(() => {
		jest.restoreAllMocks();
		documents.clear();
	});

	it("lists another project's files, without the app's own", async () => {
		const files = await fileImportService.listFiles(project('source'));

		expect(files.map((entry) => entry.path)).toEqual([
			'/figures/plot.png',
			'/main.tex',
			'/refs.bib',
		]);
		expect(fileStoreService.getProjectFiles).toHaveBeenCalledWith('source');
	});

	it('reads a file, and a linked file from its document', async () => {
		const read = (path: string) =>
			fileImportService.readFile(project('source'), {
				...(stored.find((entry) => entry.path === path) as FileNode),
				content: undefined,
			});

		expect(text(await read('/refs.bib'))).toBe('@book{knuth}');
		expect(text(await read('/main.tex'))).toBe('text from the document');

		documents.clear();
		expect(text(await read('/main.tex'))).toBe('old text');
	});

	it('fetches an imported file again from its project', async () => {
		jest
			.spyOn(authService, 'getProjects')
			.mockResolvedValue([project('source')]);
		const source = fileImportService.projectSource(
			project('source'),
			stored[1],
		);
		expect(source).toEqual({
			kind: 'project',
			projectId: 'source',
			projectName: 'source',
			path: '/main.tex',
		});

		expect(text(await fileImportService.fetchSource(source))).toBe(
			'text from the document',
		);
		await expect(
			fileImportService.fetchSource({ ...source, path: '/gone.tex' }),
		).rejects.toThrow('The file gone.tex is no longer in the project source.');
		await expect(
			fileImportService.fetchSource({
				...source,
				projectId: 'elsewhere',
				projectName: 'Ailleurs',
			}),
		).rejects.toThrow('The project Ailleurs is not on this device.');

		jest
			.spyOn(authService, 'getProjects')
			.mockResolvedValue([project('empty')]);
		await expect(
			fileImportService.fetchSource({ ...source, projectId: 'empty' }),
		).rejects.toThrow('The project empty has no files on this device.');
	});

	it("compiles another project to take its PDF, with that project's settings", async () => {
		const config = createTexliveTypesetterConfig('wss://example.org/texlive/');
		jest.spyOn(typesetterRegistryService, 'get').mockReturnValue({
			id: config.id,
			ui: config.ui,
		} as never);
		const compile = jest
			.spyOn(genericTypesetterService, 'compileSeparately')
			.mockResolvedValue({
				status: 0,
				log: '',
				format: 'pdf',
				output: new TextEncoder().encode('%PDF'),
			});
		documents.set('texlyre-project-source-yjs_metadata', {
			name: 'source',
			description: '',
			mainFile: '/main.tex',
			typesetterOptions: { texlive: { engine: 'lualatex' } },
		});

		expect(text(await fileImportService.compileOutput(project('source')))).toBe(
			'%PDF',
		);
		const [providerId, request] = compile.mock.calls[0];
		expect(providerId).toBe('texlive');
		expect(request).toMatchObject({
			mainFile: '/main.tex',
			format: 'pdf',
			options: { engine: 'lualatex', mode: 'normal', errors: 'continue' },
		});
		expect(request.files.map((file) => file.path).sort()).toEqual([
			'/figures/plot.png',
			'/main.tex',
			'/refs.bib',
		]);
		expect(
			new TextDecoder().decode(
				request.files.find((file) => file.path === '/main.tex')?.content,
			),
		).toBe('text from the document');
		expect(fileImportService.outputSource(project('source'))).toEqual({
			kind: 'output',
			projectId: 'source',
			projectName: 'source',
		});

		compile.mockResolvedValue({ status: 1, log: 'error', format: 'pdf' });
		await expect(
			fileImportService.compileOutput(project('source')),
		).rejects.toThrow('The project source did not compile.');
	});

	it('lists the other projects of the account, by name', async () => {
		jest
			.spyOn(authService, 'getProjects')
			.mockResolvedValue([
				{ ...project('zeta'), id: 'current' },
				project('Thèse'),
				{ ...project('trash'), trashedAt: 1 },
				project('article'),
			]);

		const projects = await fileImportService.listProjects('current');

		expect(projects.map((entry) => entry.name)).toEqual(['article', 'Thèse']);
	});
});

describe('files from a URL', () => {
	const realFetch = global.fetch;
	const blocked = jest.fn(async () => {
		throw new TypeError('Failed to fetch');
	});
	afterEach(() => {
		global.fetch = realFetch;
		jest.restoreAllMocks();
	});

	it('asks the server first, for a signed-in account', async () => {
		global.fetch = blocked as never;
		const server = jest
			.spyOn(accountSyncService, 'fetchThroughServer')
			.mockResolvedValue(response(200, 'through the server') as never);

		expect(text(await fileImportService.fetchUrl('https://a.org/x.bib'))).toBe(
			'through the server',
		);
		expect(server).toHaveBeenCalledWith(
			'https://a.org/x.bib',
			expect.anything(),
		);
		expect(blocked).not.toHaveBeenCalled();
	});

	it('fetches an imported file again from its URL', async () => {
		jest
			.spyOn(accountSyncService, 'fetchThroughServer')
			.mockResolvedValue(response(200, 'again') as never);

		expect(
			text(
				await fileImportService.fetchSource({
					kind: 'url',
					url: 'https://a.org/x.bib',
				}),
			),
		).toBe('again');
	});

	it('downloads in the browser without an account, when the site allows it', async () => {
		global.fetch = jest.fn(async () => response(200, 'direct')) as never;
		jest.spyOn(accountSyncService, 'fetchThroughServer').mockResolvedValue(null);

		expect(text(await fileImportService.fetchUrl('https://a.org/x.bib'))).toBe(
			'direct',
		);
	});

	it('downloads in the browser when the server is older than the page', async () => {
		global.fetch = jest.fn(async () => response(200, 'direct')) as never;
		jest
			.spyOn(accountSyncService, 'fetchThroughServer')
			.mockResolvedValue(response(404, 'Feuillet collaboration server') as never);

		expect(text(await fileImportService.fetchUrl('https://a.org/x.bib'))).toBe(
			'direct',
		);
	});

	it('explains what went wrong', async () => {
		global.fetch = blocked as never;
		const server = jest.spyOn(accountSyncService, 'fetchThroughServer');
		jest.spyOn(accountSyncService, 'isLinked').mockReturnValue(false);

		server.mockResolvedValue(null);
		await expect(
			fileImportService.fetchUrl('https://a.org/x.bib'),
		).rejects.toThrow(/Sign in to a server account/);

		server.mockResolvedValue(
			response(403, { error: 'blocked_address' }) as never,
		);
		await expect(
			fileImportService.fetchUrl('http://10.0.0.1/x'),
		).rejects.toThrow('Files cannot be fetched from local or private addresses.');

		server.mockResolvedValue(
			response(502, { error: 'upstream_status', status: 404 }) as never,
		);
		await expect(
			fileImportService.fetchUrl('https://a.org/x.bib'),
		).rejects.toThrow('The site answered with error 404.');

		global.fetch = jest.fn(async () => response(404, 'missing')) as never;
		server.mockResolvedValue(null);
		await expect(
			fileImportService.fetchUrl('https://a.org/x.bib'),
		).rejects.toThrow('The site answered with error 404.');
	});
});
