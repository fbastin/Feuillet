// scripts/generate-texstudio-commands.ts
// Writes the commands and environments of every LaTeX package and class,
// from TeXstudio's completion word lists (completion/*.cwl, GNU GPL 3), for
// the editor's completion of the packages a project loads, as on Overleaf:
// a core file (the packages most others include, and the common ones) and
// shards for the others, loaded when a project uses them.
//
//   npx tsx scripts/generate-texstudio-commands.ts [texstudio-checkout]
//
// Without a checkout, it fetches TeXstudio's completion folder with git.
// Run it again for a newer TeXstudio; the result is committed.
import { execFileSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	shardFileName,
	TEXSTUDIO_SHARDS,
	type TexstudioCore,
	type TexstudioEntry,
	texstudioShard,
} from '../src/extensions/codemirror/autocomplete/texstudioShards';

const REPOSITORY = 'https://github.com/texstudio-org/texstudio.git';
const OUTPUT = join(
	dirname(fileURLToPath(import.meta.url)),
	'../src/extensions/codemirror/autocomplete/__generated__/texstudio',
);
// A package that this many others include goes to the core file.
const CORE_INCLUDED_BY = 30;
// Always loaded, as TeXstudio does for every LaTeX file.
const BASE = ['latex-document', 'tex'];
// The packages people load most (codemirror-lang-latex's list), in the core.
const COMMON = [
	'amsmath',
	'amssymb',
	'amsfonts',
	'amsthm',
	'mathtools',
	'bm',
	'physics',
	'cancel',
	'graphicx',
	'xcolor',
	'hyperref',
	'url',
	'float',
	'wrapfig',
	'caption',
	'subcaption',
	'geometry',
	'fancyhdr',
	'lastpage',
	'setspace',
	'parskip',
	'titlesec',
	'titletoc',
	'booktabs',
	'tabularx',
	'longtable',
	'multirow',
	'multicol',
	'array',
	'makecell',
	'colortbl',
	'threeparttable',
	'tikz',
	'pgfplots',
	'pgf',
	'tikz-cd',
	'standalone',
	'circuitikz',
	'babel',
	'polyglossia',
	'inputenc',
	'fontenc',
	'fontspec',
	'csquotes',
	'microtype',
	'natbib',
	'biblatex',
	'cite',
	'glossaries',
	'nomencl',
	'acronym',
	'algorithm',
	'algorithmicx',
	'algpseudocode',
	'algorithm2e',
	'listings',
	'minted',
	'enumitem',
	'cleveref',
	'siunitx',
	'mhchem',
	'chemfig',
	'todonotes',
	'lipsum',
	'etoolbox',
	'xparse',
	'ifthen',
	'calc',
	'adjustbox',
	'rotating',
	'pdfpages',
	'tcolorbox',
	'mdframed',
	'framed',
	'ulem',
	'soul',
	'verbatim',
	'fancyvrb',
	'placeins',
	'subfiles',
	'import',
	'xspace',
	'mathrsfs',
	'stmaryrd',
	'luacode',
	'class-article',
	'class-report',
	'class-book',
	'class-beamer',
	'class-memoir',
	'class-scrartcl',
];

function checkout(path: string | undefined): { dir: string; commit: string } {
	if (path) {
		const commit = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'])
			.toString()
			.trim();
		return { dir: path, commit };
	}
	const dir = join(mkdtempSync(join(tmpdir(), 'texstudio-')), 'texstudio');
	execFileSync('git', [
		'clone',
		'--quiet',
		'--depth=1',
		'--filter=blob:none',
		'--sparse',
		REPOSITORY,
		dir,
	]);
	execFileSync('git', ['-C', dir, 'sparse-checkout', 'set', 'completion']);
	return {
		dir,
		commit: execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'])
			.toString()
			.trim(),
	};
}

/** Where the classification (#…) starts, after the command's name. */
function classificationStart(line: string): number {
	const name = /^\\(?:[a-zA-Z@]+\*?|.)/.exec(line)?.[0].length ?? 1;
	for (let i = name; i < line.length; i++) {
		if (line[i] === '\\') i++;
		else if (line[i] === '#') return i;
	}
	return -1;
}

/** A word list's includes and the lines worth completing. */
export function readWordList(text: string): {
	includes: string[];
	lines: string[];
} {
	const includes: string[] = [];
	const lines = new Set<string>();
	let inKeyvals = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (line.startsWith('#keyvals')) inKeyvals = true;
		else if (line.startsWith('#endkeyvals')) inKeyvals = false;
		else if (inKeyvals) continue;
		else if (line.startsWith('#include:')) {
			const name = line.slice('#include:'.length).trim();
			if (name && !includes.includes(name)) includes.push(name);
		} else if (line.startsWith('\\') && !line.startsWith('\\end{')) {
			const at = classificationStart(line);
			const command = (at < 0 ? line : line.slice(0, at)).trimEnd();
			const classification = at < 0 ? '' : line.slice(at + 1);
			// S: never offered; *: unusual, hidden by TeXstudio too; /%…:
			// only inside some argument, as siunitx's units.
			const flags = classification.split(/[/\\]/)[0];
			if (/[S*]/.test(flags) || /\/%/.test(classification)) continue;
			if (/^\\begin\{[^}]*%/.test(command) || command.length < 2) continue;
			lines.add(command);
		}
	}
	return { includes, lines: [...lines] };
}

/** cwlAliases.dat: a class's word lists, under its name. */
function readAliases(text: string): Record<string, string[]> {
	const aliases: Record<string, string[]> = {};
	let current: string[] | null = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		if (line.endsWith(':')) {
			current = [];
			aliases[line.slice(0, -1)] = current;
		} else current?.push(line);
	}
	return aliases;
}

function main(): void {
	const { dir, commit } = checkout(process.argv[2]);
	const completion = join(dir, 'completion');
	const entries = new Map<string, { includes: string[]; lines: string[] }>();
	for (const file of readdirSync(completion).sort()) {
		if (!file.endsWith('.cwl')) continue;
		entries.set(
			file.slice(0, -4),
			readWordList(readFileSync(join(completion, file), 'utf8')),
		);
	}

	// How many word lists reach each one through their includes.
	const reachedBy = new Map<string, number>();
	for (const name of entries.keys()) {
		const seen = new Set<string>();
		const todo = [...(entries.get(name)?.includes ?? [])];
		while (todo.length > 0) {
			const next = todo.pop() as string;
			if (seen.has(next) || !entries.has(next)) continue;
			seen.add(next);
			todo.push(...(entries.get(next)?.includes ?? []));
		}
		for (const reached of seen)
			reachedBy.set(reached, (reachedBy.get(reached) ?? 0) + 1);
	}
	const core = new Set(
		[...entries.keys()].filter(
			(name) =>
				(reachedBy.get(name) ?? 0) >= CORE_INCLUDED_BY ||
				BASE.includes(name) ||
				COMMON.includes(name),
		),
	);

	const aliases = Object.fromEntries(
		Object.entries(
			readAliases(readFileSync(join(completion, 'cwlAliases.dat'), 'utf8')),
		).filter(
			([name, lists]) => lists.join(' ') !== `class-${name} latex-document tex`,
		),
	);

	const row = (name: string): TexstudioEntry => {
		const { includes, lines } = entries.get(name) as {
			includes: string[];
			lines: string[];
		};
		return [name, includes, lines];
	};
	// One package per line, so that a newer TeXstudio reads as a short diff.
	const rows = (names: string[]) =>
		names.map((name) => JSON.stringify(row(name))).join(',\n');

	rmSync(OUTPUT, { recursive: true, force: true });
	mkdirSync(OUTPUT, { recursive: true });
	const coreNames = [...core].sort();
	const coreFile: Omit<TexstudioCore, 'packages'> = {
		source: `texstudio-org/texstudio@${commit}`,
		aliases,
	};
	writeFileSync(
		join(OUTPUT, 'core.json'),
		`${JSON.stringify(coreFile).slice(0, -1)},"packages":[\n${rows(coreNames)}\n]}\n`,
	);
	const shards = new Map<number, string[]>();
	for (const name of [...entries.keys()].sort()) {
		if (core.has(name)) continue;
		const shard = texstudioShard(name);
		shards.set(shard, [...(shards.get(shard) ?? []), name]);
	}
	for (let shard = 0; shard < TEXSTUDIO_SHARDS; shard++) {
		writeFileSync(
			join(OUTPUT, shardFileName(shard)),
			`[\n${rows(shards.get(shard) ?? [])}\n]\n`,
		);
	}

	if (existsSync(join(dir, 'COPYING')))
		copyFileSync(join(dir, 'COPYING'), join(OUTPUT, 'COPYING'));
	writeFileSync(
		join(OUTPUT, 'README.md'),
		`# Commands of LaTeX packages and classes, from TeXstudio

These files are derived from the completion word lists of
[TeXstudio](https://github.com/texstudio-org/texstudio) (\`completion/*.cwl\`,
commit ${commit}), by their authors and TeXstudio's contributors, under the
GNU General Public License version 3 (see [COPYING](COPYING)).

\`scripts/generate-texstudio-commands.ts\` writes them: the packages' includes
and their commands and environments, without TeXstudio's classification
(those it never offers, marks unusual or keeps for some arguments left out).
\`core.json\` holds the packages that ${CORE_INCLUDED_BY} or more others include
and the common ones; the others are in \`shard-NNN.json\` by a hash of their
name (\`texstudioShards.ts\`). Feuillet's editor loads those of the packages a
project uses, for its command completion.
`,
	);

	const lines = [...entries.values()].reduce(
		(sum, entry) => sum + entry.lines.length,
		0,
	);
	console.log(
		`TeXstudio ${commit.slice(0, 10)}: ${entries.size} word lists, ${lines} commands; core ${core.size}, ${shards.size} shards → ${OUTPUT}`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
	main();
