import type { Project } from '@src/types/projects';
import {
	type AccountProject,
	accountFieldsChanged,
	getAccountServerUrl,
	planAccountSync,
	toAccountProject,
} from '@src/utils/accountSyncUtils';
import { FORCED_DEFAULTS_KEY } from '@src/utils/userDataUtils';

const {
	cleanProject,
	cleanWord,
	mergeProjects,
	mergeWords,
} = require('../../../server/collab/accounts');

const project = (overrides: Partial<Project> = {}): Project => ({
	id: 'p1',
	name: 'Thesis',
	description: '',
	type: 'latex',
	docUrl: 'yjs:p1',
	createdAt: 10,
	updatedAt: 100,
	ownerId: 'local-user',
	tags: [],
	isFavorite: false,
	...overrides,
});

const entry = (overrides: Partial<AccountProject> = {}): AccountProject => ({
	...toAccountProject(project()),
	...overrides,
});

describe('planAccountSync', () => {
	it('creates the projects this device does not have yet', () => {
		const plan = planAccountSync([], [entry({ name: 'From elsewhere' })], 'me');

		expect(plan.create).toEqual([
			expect.objectContaining({
				id: 'p1',
				docUrl: 'yjs:p1',
				name: 'From elsewhere',
				ownerId: 'me',
				updatedAt: 100,
				accountUpdatedAt: 100,
			}),
		]);
		expect(plan.update).toEqual([]);
	});

	it('takes a newer version and keeps what belongs to this device', () => {
		const local = project({
			lastOpenedFilePath: '/intro.tex',
			updatedAt: 150,
			accountUpdatedAt: 100,
		});
		const plan = planAccountSync(
			[local],
			[entry({ name: 'Renamed', tags: ['x'], updatedAt: 120 })],
			'local-user',
		);

		// The local copy was only opened at 150; its listed fields date from 100.
		expect(plan.update).toEqual([
			expect.objectContaining({
				name: 'Renamed',
				tags: ['x'],
				lastOpenedFilePath: '/intro.tex',
				updatedAt: 150,
				accountUpdatedAt: 120,
			}),
		]);
	});

	it('keeps a local version that is newer', () => {
		const local = project({ name: 'Mine', accountUpdatedAt: 200, updatedAt: 200 });
		const plan = planAccountSync([local], [entry({ updatedAt: 150 })], 'local-user');

		expect(plan).toEqual({ create: [], update: [], remove: [] });
	});

	it('removes a project deleted on another device unless it changed here since', () => {
		const deleted = { id: 'p1', updatedAt: 300, deleted: true };

		expect(planAccountSync([project()], [deleted], 'u').remove).toHaveLength(1);
		expect(
			planAccountSync([project({ accountUpdatedAt: 400 })], [deleted], 'u').remove,
		).toHaveLength(0);
		expect(planAccountSync([], [deleted], 'u').create).toHaveLength(0);
	});
});

describe('account fields', () => {
	it('sends when the listed fields last changed', () => {
		expect(toAccountProject(project({ updatedAt: 500, accountUpdatedAt: 120 })))
			.toEqual(expect.objectContaining({ updatedAt: 120 }));
		expect(toAccountProject(project({ updatedAt: 500 })).updatedAt).toBe(500);
		expect(toAccountProject(project({ lastOpenedFilePath: '/a.tex' }))).not.toHaveProperty(
			'lastOpenedFilePath',
		);
	});

	it('tells listed fields from per-device ones', () => {
		expect(accountFieldsChanged(project(), project({ name: 'Other' }))).toBe(true);
		expect(accountFieldsChanged(project(), project({ tags: ['a'] }))).toBe(true);
		expect(
			accountFieldsChanged(project(), project({ lastOpenedFilePath: '/b.tex', updatedAt: 9 })),
		).toBe(false);
	});
});

describe('getAccountServerUrl', () => {
	afterEach(() => localStorage.clear());

	it('follows the WebSocket server setting, then the site default', () => {
		localStorage.setItem(
			FORCED_DEFAULTS_KEY,
			JSON.stringify({
				version: '1',
				settings: { 'collab-websocket-server': 'wss://example.org/collab/' },
				properties: {},
			}),
		);
		expect(getAccountServerUrl()).toBe('https://example.org/collab');
		expect(getAccountServerUrl('u1')).toBe('https://example.org/collab');

		localStorage.setItem(
			'texlyre-user-u1-settings',
			JSON.stringify({ 'collab-websocket-server': 'ws://localhost:1234' }),
		);
		expect(getAccountServerUrl('u1')).toBe('http://localhost:1234');
	});

	it('reads the site defaults stored at startup', () => {
		localStorage.setItem(
			'texlyre-settings',
			JSON.stringify({ 'collab-websocket-server': 'wss://site.example/collab', _version: '1' }),
		);
		expect(getAccountServerUrl()).toBe('https://site.example/collab');
	});

	it('is empty without a WebSocket server', () => {
		expect(getAccountServerUrl()).toBe('');
	});
});

describe('server-side project list', () => {
	it('keeps only the listed fields of valid projects', () => {
		expect(cleanProject({ id: '../x', updatedAt: 1 })).toBeNull();
		expect(cleanProject({ id: 'p1' })).toBeNull();
		expect(
			cleanProject({ ...entry(), ownerId: 'someone', lastOpenedFilePath: '/a.tex' }),
		).toEqual({ ...entry(), group: undefined, compilerId: undefined });
		expect(cleanProject({ id: 'p1', updatedAt: 5, deleted: true, name: 'x' })).toEqual({
			id: 'p1',
			updatedAt: 5,
			deleted: true,
		});
	});

	it('keeps the most recent version, a deletion included', () => {
		const stored = { p1: cleanProject(entry({ name: 'A', updatedAt: 100 })) };

		expect(mergeProjects(stored, [entry({ name: 'Old', updatedAt: 50 })]).p1.name).toBe('A');
		expect(mergeProjects(stored, [entry({ name: 'New', updatedAt: 150 })]).p1.name).toBe(
			'New',
		);
		expect(
			mergeProjects(stored, [{ id: 'p1', updatedAt: 100, deleted: true }]).p1.deleted,
		).toBe(true);
	});
});

describe('server-side dictionary', () => {
	it('keeps words only', () => {
		expect(cleanWord({ word: "aujourd'hui", updatedAt: 1 })).toEqual({
			word: "aujourd'hui",
			updatedAt: 1,
		});
		expect(cleanWord({ word: 'deux mots', updatedAt: 1 })).toBeNull();
		expect(cleanWord({ word: '<script>', updatedAt: 1 })).toBeNull();
		expect(cleanWord({ word: 'mot', updatedAt: 'tard' })).toBeNull();
	});

	it('keeps the most recent version of each word, a deletion included', () => {
		const stored = mergeWords({}, [{ word: 'fautte', updatedAt: 100 }]);

		expect(mergeWords(stored, [{ word: 'fautte', updatedAt: 50, deleted: true }]).fautte)
			.toEqual({ word: 'fautte', updatedAt: 100 });
		expect(mergeWords(stored, [{ word: 'fautte', updatedAt: 100, deleted: true }]).fautte)
			.toEqual({ word: 'fautte', updatedAt: 100, deleted: true });
		expect(Object.hasOwn(mergeWords({}, [{ word: 'constructor', updatedAt: 1 }]), 'constructor'))
			.toBe(true);
	});
});
