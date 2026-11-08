// A real repository (isomorphic-git on Node's file system, under a
// temporary folder, a new one for each test): commits keep the submodules
// HEAD has, and merges combine changes on different lines on their own.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as git from 'isomorphic-git';

let mockRoot = '';
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

beforeEach(() => {
	mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feuillet-git-'));
});
afterEach(() => fs.rmSync(mockRoot, { recursive: true, force: true }));

describe('GitService commits and submodules', () => {
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

// main.tex as committed by `oid`.
const textOf = async (oid: string, file = 'main.tex'): Promise<string> => {
	const { blob } = await git.readBlob({ ...options, oid, filepath: file });
	return new TextDecoder().decode(blob);
};

// A branch « remote » from `from`, with `files` changed, made without
// touching the project (as a fetch brings it).
const remoteCommit = async (
	from: string,
	files: Record<string, string | Uint8Array>,
): Promise<string> => {
	const { commit } = await git.readCommit({ ...options, oid: from });
	const { tree } = await git.readTree({ ...options, oid: commit.tree });
	const entries = new Map(tree.map((entry) => [entry.path, entry]));
	for (const [file, content] of Object.entries(files)) {
		const blob = await git.writeBlob({
			...options,
			blob: typeof content === 'string' ? new TextEncoder().encode(content) : content,
		});
		entries.set(file, { mode: '100644', path: file, oid: blob, type: 'blob' });
	}
	const treeOid = await git.writeTree({ ...options, tree: [...entries.values()] });
	const oid = await git.writeCommit({
		...options,
		commit: { tree: treeOid, parent: [from], author, committer: author, message: 'Remote\n' },
	});
	await git.writeRef({ ...options, ref: 'refs/heads/remote', value: oid, force: true });
	return oid;
};

const startRepository = async (files: Record<string, string | Uint8Array>) => {
	await git.init({ ...options, defaultBranch: 'main' });
	for (const [file, content] of Object.entries(files)) {
		await fs.promises.writeFile(path.join(mockRoot, file), content);
	}
	return gitService.commit('project-1', 'Start', null);
};

describe('GitService merges', () => {
	it('merges on its own a line added at the top on one side and at the bottom on the other', async () => {
		const start = await startRepository({ 'main.tex': 'A\nB\nC\nD\n' });
		await editAndCommit('A\nB\nC\nD\nFeuillet\n');
		await remoteCommit(start, { 'main.tex': 'GitHub\nA\nB\nC\nD\n' });

		const result = await gitService.mergeBranch('project-1', 'remote', null);

		expect(result.status).toBe('merged');
		if (result.status !== 'merged' || !result.oid) throw new Error('no merge');
		expect(await textOf(result.oid)).toBe('GitHub\nA\nB\nC\nD\nFeuillet\n');
	});

	it('leaves the same line changed on both sides to the merge window', async () => {
		const start = await startRepository({ 'main.tex': 'A\nB\nC\n' });
		await editAndCommit('A\nB from Feuillet\nC\n');
		await remoteCommit(start, { 'main.tex': 'A\nB from GitHub\nC\n' });

		const result = await gitService.mergeBranch('project-1', 'remote', null);

		expect(result.status).toBe('conflicts');
		if (result.status !== 'conflicts') throw new Error('no conflict');
		expect(result.plan.conflicts.map((conflict) => conflict.path)).toEqual([
			'main.tex',
		]);
	});

	it('leaves a binary file changed on both sides to the merge window', async () => {
		const start = await startRepository({
			'main.tex': 'A\n',
			'figure.png': new Uint8Array([1, 2, 3]),
		});
		await fs.promises.writeFile(
			path.join(mockRoot, 'figure.png'),
			new Uint8Array([1, 2, 3, 4]),
		);
		await gitService.commit('project-1', 'Image', null);
		await remoteCommit(start, { 'figure.png': new Uint8Array([0, 1, 2, 3]) });

		const result = await gitService.mergeBranch('project-1', 'remote', null);

		expect(result.status).toBe('conflicts');
	});
});
