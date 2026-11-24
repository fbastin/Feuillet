// src/utils/feuilletPackage.ts
// feuillet.sty, the package with which a project writes requests to
// assistants (\prompt, server/collab/prompts.js). The TeX Live server has
// it installed (server/texlive/Dockerfile); compiles in the browser are
// given it at the project's root, unless the project has its own; and a
// project may take a copy of it, to compile elsewhere too (Git, archives).
import type { FileNode } from '../types/files';

export const FEUILLET_STY_NAME = 'feuillet.sty';
export const FEUILLET_STY_PATH = `/${FEUILLET_STY_NAME}`;

let loading: Promise<string | null> | null = null;

/** The package's text, from the same file as the TeX Live server's. */
export const loadFeuilletSty = (): Promise<string | null> => {
	loading ??= import(
		'../../server/texlive/texmf/tex/latex/feuillet/feuillet.sty?raw'
	)
		.then((module) => module.default as string)
		.catch(() => {
			loading = null;
			return null;
		});
	return loading;
};

const hasFile = (nodes: FileNode[], path: string): boolean =>
	nodes.some(
		(node) =>
			(node.type === 'file' && !node.isDeleted && node.path === path) ||
			(node.children?.length ? hasFile(node.children, path) : false),
	);

/** Whether the project has a feuillet.sty of its own, at its root. */
export const hasFeuilletSty = (tree: FileNode[]): boolean =>
	hasFile(tree, FEUILLET_STY_PATH);

/** The tree to compile, with feuillet.sty at its root unless it has one. */
export const withFeuilletSty = async (
	tree: FileNode[],
): Promise<FileNode[]> => {
	if (hasFeuilletSty(tree)) return tree;
	const content = await loadFeuilletSty();
	if (!content) return tree;
	return [
		...tree,
		{
			id: 'feuillet-package',
			name: FEUILLET_STY_NAME,
			path: FEUILLET_STY_PATH,
			type: 'file',
			content,
			lastModified: 0,
			size: content.length,
			excludeFromSync: true,
		},
	];
};
