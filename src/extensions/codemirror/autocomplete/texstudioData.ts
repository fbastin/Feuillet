// src/extensions/codemirror/autocomplete/texstudioData.ts
// Loads TeXstudio's word lists (see texstudioShards.ts). A module of its
// own, imported when the completion first wants it, so that the table of
// the 512 shard files stays out of the editor's code.
import {
	type TexstudioCore,
	type TexstudioEntry,
	texstudioShard,
} from './texstudioShards';

type Loaded = {
	core: Map<string, TexstudioEntry>;
	aliases: TexstudioCore['aliases'];
};
let core: Promise<Loaded> | null = null;
const shards = new Map<number, Promise<Map<string, TexstudioEntry>>>();

const asEntries = (rows: TexstudioEntry[]) =>
	new Map(rows.map((row) => [row[0], row] as const));

export function loadCore(): Promise<Loaded> {
	core ??= import('./__generated__/texstudio/core.json').then((module) => {
		const data = (module.default ?? module) as unknown as TexstudioCore;
		return { core: asEntries(data.packages), aliases: data.aliases };
	});
	core.catch(() => {
		core = null;
	});
	return core;
}

function loadShard(shard: number): Promise<Map<string, TexstudioEntry>> {
	let loading = shards.get(shard);
	if (!loading) {
		loading = import(
			`./__generated__/texstudio/shard-${String(shard).padStart(3, '0')}.json`
		).then((module) =>
			asEntries((module.default ?? module) as unknown as TexstudioEntry[]),
		);
		shards.set(shard, loading);
		loading.catch(() => shards.delete(shard));
	}
	return loading;
}

/** A package's or class's word list, from the core or its shard. */
export async function entryOf(
	name: string,
): Promise<TexstudioEntry | undefined> {
	const { core: found } = await loadCore();
	return found.get(name) ?? (await loadShard(texstudioShard(name))).get(name);
}
