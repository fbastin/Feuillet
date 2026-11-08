// A real repository (isomorphic-git on Node's file system, under a
// temporary folder): a commit keeps the submodules HEAD has, though the
// index lags behind HEAD after a merge (isomorphic-git's merge does not
// touch it, statusMatrix skips submodules).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as git from 'isomorphic-git';

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feuillet-submodules-'));
// The project's file system, as GitService sees it: « / » is mockRoot.
const mockFs = {
	promises: Object.fromEntries(
		[
			'readFile',
			'writeFile',
			'unlink',
			'readdir',
			'mkdir',
			'rmdir',
			'stat',
			'lstat',
			'readlink',
			'symlink',
			'chmod',
		].map((name) => [
			name,
			// async: a promise even when isomorphic-git probes it with no path.
			async (target: string, ...rest: unknown[]) =>
				(fs.promises as unknown as Record<string, (...args: unknown[]) => unknown>)[
					name
				](path.join(mockRoot, target), ...rest),
		]),
	),
};

jest.mock('@src/services/GitFileSystemService', () => ({
	gitFileSystemService: {
		get: () => ({
			fs: mockFs,
			flush: async () => undefined,
		}),
	},
}));
jest.mock('@src/services/FileHandlerService', () => ({
	fileHandlerService: {
		withoutMirroring: async (action: () => Promise<unknown>) => action(),
		mirrorFiles: async () => undefined,
		removeFromDisk: async () => undefined,
	},
}));
jest.mock('@src/services/FileStoreService', () => ({
	fileStoreService: {
		getCurrentProjectId: () => 'project-1',
		initialize: async () => undefined,
		getAllFiles: async () => [],
	},
}));

import { gitService } from '@src/services/GitService';

const options = { fs: mockFs, dir: '/', gitdir: '/.git' };
const author = { name: 'A', email: 'a@example.org', timestamp: 1, timezoneOffset: 0 };
const ONE = '1'.repeat(40);
const TWO = '2'.repeat(40);

// A commit made outside the index, as a merge makes it, and HEAD moved to it.
const commitTree = async (
	parents: string[],
	submodule: string | null,
	text: string,
): Promise<string> => {
	const blob = await git.writeBlob({ ...options, blob: new TextEncoder().encode(text) });
	const tree = await git.writeTree({
		...options,
		tree: [
			{ mode: '100644', path: 'main.tex', oid: blob, type: 'blob' },
			...(submodule
				? [{ mode: '160000', path: 'theme', oid: submodule, type: 'commit' as const }]
				: []),
		],
	});
	const oid = await git.writeCommit({
		...options,
		commit: { tree, parent: parents, author, committer: author, message: 'Remote\n' },
	});
	await git.writeRef({ ...options, ref: 'refs/heads/main', value: oid, force: true });
	return oid;
};

const submoduleOf = async (oid: string): Promise<string | null> => {
	const { commit } = await git.readCommit({ ...options, oid });
	const { tree } = await git.readTree({ ...options, oid: commit.tree });
	return tree.find((entry) => entry.path === 'theme')?.oid ?? null;
};

const editAndCommit = async (text: string): Promise<string> => {
	await fs.promises.writeFile(path.join(mockRoot, 'main.tex'), text);
	return gitService.commit('project-1', 'Edit', null);
};

describe('GitService commits and submodules', () => {
	afterAll(() => fs.rmSync(mockRoot, { recursive: true, force: true }));

	it('keeps the submodule HEAD has, moved or removed, whatever the index holds', async () => {
		await git.init({ ...options, defaultBranch: 'main' });
		await fs.promises.writeFile(path.join(mockRoot, 'main.tex'), 'base');
		// The repository's commit, with a submodule; the index has never seen it.
		const base = await commitTree([], ONE, 'base');

		const first = await editAndCommit('first edit');
		expect(await submoduleOf(first)).toBe(ONE);

		// GitHub moved the submodule; the index still has the old commit.
		await commitTree([first], TWO, 'first edit');
		const second = await editAndCommit('second edit');
		expect(await submoduleOf(second)).toBe(TWO);

		// GitHub removed it.
		await commitTree([second], null, 'second edit');
		const third = await editAndCommit('third edit');
		expect(await submoduleOf(third)).toBeNull();
		expect(base).toBeTruthy();
	});
});
