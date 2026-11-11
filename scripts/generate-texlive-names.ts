// scripts/generate-texlive-names.ts
// Writes the names of every package (.sty), class (.cls) and BibTeX style
// (.bst) of TeX Live, with the one-line description of the TeX Live package
// each comes from, for the completion of \usepackage{…}, \documentclass{…}
// and \bibliographystyle{…} (as on Overleaf).
//
//   npx tsx scripts/generate-texlive-names.ts [texlive.tlpdb]
//
// Without a file, it downloads the current database from CTAN (needs xz).
// Run it again after a new TeX Live release; the result is committed.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TLPDB_URL =
	'https://mirror.ctan.org/systems/texlive/tlnet/tlpkg/texlive.tlpdb.xz';
const OUTPUT = join(
	dirname(fileURLToPath(import.meta.url)),
	'../src/extensions/codemirror/autocomplete/__generated__/texliveNames.json',
);

// The trees pdfLaTeX, XeLaTeX and LuaLaTeX look in, and the engine a tree
// is for ('' for all). Earlier trees win for a name found in several.
const TREES: ReadonlyArray<[string, string]> = [
	['latex', ''],
	['generic', ''],
	['xelatex', 'xe'],
	['xetex', 'xe'],
	['lualatex', 'lua'],
	['luatex', 'lua'],
];

type Found = { bundle: string; engine: string; rank: number };

function readDatabase(path: string | undefined): string {
	if (path) return readFileSync(path, 'utf8');
	const xz = execFileSync('curl', ['-fsSL', TLPDB_URL], {
		maxBuffer: 1 << 28,
	});
	return execFileSync('xz', ['-dc'], {
		input: xz,
		maxBuffer: 1 << 30,
	}).toString('utf8');
}

function main(): void {
	const text = readDatabase(process.argv[2]);
	const release = /^depend release\/(\d{4})$/m.exec(text)?.[1];
	if (!release) throw new Error('Not a TeX Live database: no release line.');

	const descriptions = new Map<string, string>();
	const names = {
		sty: new Map<string, Found>(),
		cls: new Map<string, Found>(),
		bst: new Map<string, Found>(),
	};
	const everyEngine = new Set<string>();

	for (const stanza of text.split(/\n\n+/)) {
		const bundle = /^name (\S+)$/m.exec(stanza)?.[1];
		// Binaries (name.arch), collections and schemes hold no .sty.
		if (!bundle || bundle.includes('.')) continue;
		descriptions.set(bundle, /^shortdesc (.+)$/m.exec(stanza)?.[1] ?? '');
		for (const [, path] of stanza.matchAll(
			/^ (?:RELOC|texmf-dist)\/bibtex\/bst\/(?:.*\/)?([^/\s]+)\.bst$/gm,
		)) {
			if (!names.bst.has(path) || path === bundle)
				names.bst.set(path, { bundle, engine: '', rank: 0 });
		}
		for (const [, path] of stanza.matchAll(
			/^ (?:RELOC|texmf-dist)\/tex\/(\S+)$/gm,
		)) {
			const file = /^([^/]+)\/(?:.*\/)?([^/]+)\.(sty|cls)$/.exec(path);
			if (!file) continue;
			const [, tree, name, kind] = file;
			const rank = TREES.findIndex(([t]) => t === tree);
			if (rank < 0) continue;
			const map = names[kind as 'sty' | 'cls'];
			const before = map.get(name);
			// The bundle named like the file wins, then the more general tree.
			const better =
				!before ||
				(name === bundle && name !== before.bundle) ||
				(rank < before.rank && before.bundle !== name);
			if (better) map.set(name, { bundle, engine: TREES[rank][1], rank });
			if (!TREES[rank][1]) everyEngine.add(`${kind}:${name}`);
		}
	}
	// A name some tree has for every engine is for every engine.
	for (const kind of ['sty', 'cls'] as const) {
		for (const [name, found] of names[kind]) {
			if (everyEngine.has(`${kind}:${name}`)) found.engine = '';
		}
	}

	// Each bundle's description once; entries point at it by index.
	const bundles: Array<[string, string]> = [];
	const bundleIndex = new Map<string, number>();
	const entries = (map: Map<string, Found>) =>
		[...map.keys()]
			.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
			.map((name) => {
				const { bundle, engine } = map.get(name) as Found;
				let index = bundleIndex.get(bundle);
				if (index === undefined) {
					index = bundles.length;
					bundleIndex.set(bundle, index);
					bundles.push([bundle, descriptions.get(bundle) ?? '']);
				}
				return engine ? [name, index, engine] : [name, index];
			});
	const sty = entries(names.sty);
	const cls = entries(names.cls);
	const bst = entries(names.bst);

	// One entry per line, so that a new release reads as a short diff.
	const lines = (rows: unknown[]) =>
		rows.map((row) => JSON.stringify(row)).join(',\n');
	writeFileSync(
		OUTPUT,
		`{"release":${release},\n"bundles":[\n${lines(bundles)}\n],\n"sty":[\n${lines(sty)}\n],\n"cls":[\n${lines(cls)}\n],\n"bst":[\n${lines(bst)}\n]}\n`,
	);
	console.log(
		`TeX Live ${release}: ${sty.length} packages, ${cls.length} classes, ${bst.length} BibTeX styles, ${bundles.length} bundles → ${OUTPUT}`,
	);
}

main();
