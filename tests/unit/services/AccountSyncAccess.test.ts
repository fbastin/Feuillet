import type { Project } from '@src/types/projects';

type Modules = {
	accounts: typeof import('@src/services/AccountSyncService').accountSyncService;
	links: typeof import('@src/services/ProjectLinkService').projectLinkService;
};

const EDIT = '11111111-1111-4111-8111-111111111111';
const NEW_EDIT = '22222222-2222-4222-8222-222222222222';
const VIEW = `view${'a'.repeat(32)}`;
const NEW_VIEW = `view${'b'.repeat(32)}`;

const project = (id: string): Project => ({
	id,
	name: 'Thèse',
	description: '',
	type: 'latex',
	docUrl: `yjs:${id}`,
	createdAt: 1,
	updatedAt: 1,
	ownerId: 'u1',
	tags: [],
	isFavorite: false,
});

const load = (projects: Project[]) => {
	let modules: Modules | undefined;
	jest.isolateModules(() => {
		modules = {
			accounts: require('@src/services/AccountSyncService').accountSyncService,
			links: require('@src/services/ProjectLinkService').projectLinkService,
		};
	});
	const { accounts, links } = modules as Modules;
	const stored: Project[] = [];
	accounts.attachStore({
		getProjects: async () => projects,
		storeProject: async (updated) => {
			stored.push(updated);
		},
		removeProject: async () => undefined,
	});
	localStorage.setItem(
		'feuillet-account-u1',
		JSON.stringify({ username: 'ana', token: 't', server: 'https://s' }),
	);
	(accounts as unknown as { userId: string }).userId = 'u1';
	return { accounts, links, stored };
};

const answer = (body: unknown) =>
	jest.fn(async () => ({ ok: true, status: 200, json: async () => body }));

describe('project access through the account', () => {
	beforeEach(() => {
		localStorage.clear();
		jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it('moves an editor to the current editing link and keeps it for the account', async () => {
		const { accounts, links, stored } = load([project(EDIT)]);
		global.fetch = answer({ owner: 'other', role: 'editor', edit: NEW_EDIT }) as never;

		const access = await accounts.projectAccess(EDIT);

		expect(access).toEqual({ owner: 'other', role: 'editor', edit: NEW_EDIT, view: undefined });
		expect(links.serverId(EDIT)).toBe(NEW_EDIT);
		expect(stored).toEqual([expect.objectContaining({ id: EDIT, editId: NEW_EDIT })]);
		const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
		expect(url).toBe('https://s/share/edit');
		expect(JSON.parse(init.body)).toEqual({ project: EDIT });
	});

	it('moves a reader to the current read-only link, never to an editing one', async () => {
		const { accounts, links } = load([project(VIEW)]);
		global.fetch = answer({ owner: 'other', role: 'reader', view: NEW_VIEW, edit: NEW_EDIT }) as never;

		await accounts.projectAccess(VIEW);

		expect(links.serverId(VIEW)).toBe(NEW_VIEW);
	});

	it('ignores a link of the wrong kind', async () => {
		const { accounts, links } = load([project(EDIT)]);
		global.fetch = answer({ owner: 'other', role: 'editor', edit: NEW_VIEW }) as never;

		const access = await accounts.projectAccess(EDIT);

		expect(access?.edit).toBeUndefined();
		expect(links.serverId(EDIT)).toBe(EDIT);
	});

	it('lists, invites and removes collaborators under the current link', async () => {
		const { accounts, links } = load([project(EDIT)]);
		links.setServerId(EDIT, NEW_EDIT);
		global.fetch = answer({
			members: [
				{ username: 'bea', role: 'editor' },
				{ username: 'bad', role: 'admin' },
			],
			edit: NEW_EDIT,
		}) as never;

		const members = await accounts.projectMembers(EDIT, {
			add: { username: 'bea', role: 'editor' },
			name: 'Thèse',
		});

		expect(members).toEqual([{ username: 'bea', role: 'editor' }]);
		const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
		expect(url).toBe('https://s/share/members');
		expect(JSON.parse(init.body)).toEqual({
			project: NEW_EDIT,
			add: { username: 'bea', role: 'editor' },
			name: 'Thèse',
		});
	});

	it('gives nothing without a signed-in account', async () => {
		const { accounts } = load([]);
		localStorage.clear();
		global.fetch = jest.fn() as never;

		expect(await accounts.projectAccess(EDIT)).toBeNull();
		expect(await accounts.projectMembers(EDIT)).toBeNull();
		expect(global.fetch).not.toHaveBeenCalled();
	});
});
