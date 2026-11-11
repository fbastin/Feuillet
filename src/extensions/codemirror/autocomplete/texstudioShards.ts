// src/extensions/codemirror/autocomplete/texstudioShards.ts
// Where a package's commands are, among the files that
// scripts/generate-texstudio-commands.ts writes from TeXstudio's word lists:
// the core file (the packages most others include, and the common ones),
// else the shard its name hashes to. Shared by the script and the editor.

/** How many shard files the packages outside the core are spread over. */
export const TEXSTUDIO_SHARDS = 512;

/** FNV-1a of the name: its shard, 0 to TEXSTUDIO_SHARDS - 1. */
export function texstudioShard(name: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < name.length; i++) {
		hash ^= name.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash % TEXSTUDIO_SHARDS;
}

export const shardFileName = (shard: number): string =>
	`shard-${String(shard).padStart(3, '0')}.json`;

/**
 * One package or class (« class-memoir »): the word lists it includes, and
 * its commands and environments as TeXstudio writes them (\ang{angle},
 * \begin{tabular}{cols}), without the classification after #.
 */
export type TexstudioEntry = [
	name: string,
	includes: string[],
	lines: string[],
];

export interface TexstudioCore {
	/** TeXstudio's commit the files come from. */
	source: string;
	/** The word lists a class stands for, when not class-X, latex-document, tex. */
	aliases: Record<string, string[]>;
	packages: TexstudioEntry[];
}
