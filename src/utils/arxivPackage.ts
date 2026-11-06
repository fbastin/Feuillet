// src/utils/arxivPackage.ts
// A project as arXiv takes it (https://info.arxiv.org/help/submit_tex.html):
// its sources, the .bbl of the last compile named after the main file (and
// its index and glossaries, .ind, .gls, .acr, .sls or .nls, when there are
// some), without what compiling
// writes, and a 00README.json naming the main file, the compiler and the
// TeX Live year (https://info.arxiv.org/help/00README.html).

export interface ArxivFile {
	/** From the project's root, without a leading slash. */
	path: string;
	content: Uint8Array;
}

/** What arXiv may refuse or compile otherwise, for the author to check. */
export type ArxivWarning =
	/** arXiv compiles with pdfLaTeX or XeLaTeX, not LuaLaTeX. */
	| 'lualatex'
	/** arXiv compiles from the archive's root. */
	| 'not-at-root'
	/** A bibliography, but no .bbl: arXiv runs neither BibTeX nor Biber. */
	| 'no-bbl'
	/** The .bbl of biblatex is of another format than arXiv's TeX Live. */
	| 'biblatex-format'
	/** The last compile had errors. */
	| 'compile-errors';

export interface ArxivPackage {
	files: ArxivFile[];
	compiler: 'pdflatex' | 'latex' | 'xelatex' | null;
	texLiveVersion: 2023 | 2025;
	warnings: ArxivWarning[];
}

// Files a compile writes for the main file, which arXiv asks not to send
// (all but the .bbl, the index and the glossaries, which it needs).
const WRITTEN = [
	'aux',
	'log',
	'toc',
	'lot',
	'lof',
	'dvi',
	'pdf',
	'out',
	'synctex.gz',
	'synctex',
	'fls',
	'fdb_latexmk',
	'blg',
	'bcf',
	'run.xml',
	'xdv',
	'nav',
	'snm',
	'vrb',
	'ilg',
	'idx',
	'glo',
	'glg',
	'acn',
	'alg',
	'slo',
	'slg',
	'ist',
	'nlo',
	'nlg',
];

/** What the compile writes that arXiv needs. */
export const ARXIV_GENERATED = ['bbl', 'ind', 'gls', 'acr', 'sls', 'nls'];

const README_NAMES = /^00readme(\.[a-z]+)?$/i;

const withoutSlash = (path: string): string => path.replace(/^\/+/, '');

/** The main file's folder ('' at the root) and name without extension. */
export const mainFileParts = (
	mainFile: string,
): { folder: string; job: string } => {
	const path = withoutSlash(mainFile);
	const slash = path.lastIndexOf('/');
	const name = slash >= 0 ? path.slice(slash + 1) : path;
	return {
		folder: slash >= 0 ? path.slice(0, slash + 1) : '',
		job: name.replace(/\.[^.]+$/, ''),
	};
};

/** The paths, as the compile server names them, of what arXiv needs. */
export const arxivGeneratedPaths = (mainFile: string): string[] => {
	const { folder, job } = mainFileParts(mainFile);
	return ARXIV_GENERATED.map((extension) => `${folder}${job}.${extension}`);
};

/** The year of the TeX Live that wrote a log: "TeX Live 2025". */
export const texLiveYearOf = (log: string): number | null => {
	const match = /TeX Live (\d{4})/.exec(log);
	return match ? Number(match[1]) : null;
};

/** The years of TeX Live arXiv compiles with. */
export const ARXIV_TEXLIVE_YEARS: readonly number[] = [2023, 2025];

// arXiv offers TeX Live 2023 and 2025; a later one is nearest to 2025.
const arxivTexLive = (year: number | null): 2023 | 2025 =>
	year !== null && year <= 2023 ? 2023 : 2025;

// The format biblatex writes its .bbl in, which must be arXiv's.
const BBL_FORMAT = { 2023: '3.2', 2025: '3.3' } as const;
const bblFormatOf = (text: string): string | null =>
	/biblatex bbl format version (\d+(?:\.\d+)*)/.exec(text)?.[1] ?? null;

const isHidden = (path: string): boolean =>
	path.split('/').some((part) => part.startsWith('.'));

export const buildArxivPackage = (input: {
	mainFile: string;
	engine: string;
	/** The project's files, as compiled. */
	files: ArxivFile[];
	/** What the compile wrote that arXiv needs (arxivGeneratedPaths). */
	generated: ArxivFile[];
	log: string;
	status: number;
}): ArxivPackage => {
	const main = withoutSlash(input.mainFile);
	const { folder, job } = mainFileParts(main);
	const written = new Set(
		WRITTEN.map((extension) => `${folder}${job}.${extension}`),
	);
	const generated = new Map(
		input.generated.map((file) => [withoutSlash(file.path), file.content]),
	);

	const files: ArxivFile[] = [];
	let ownReadme = false;
	for (const file of input.files) {
		const path = withoutSlash(file.path);
		if (!path || isHidden(path) || written.has(path) || generated.has(path)) {
			continue;
		}
		if (README_NAMES.test(path)) ownReadme = true;
		files.push({ path, content: file.content });
	}
	for (const [path, content] of generated) files.push({ path, content });

	const warnings: ArxivWarning[] = [];
	const engine = input.engine || 'pdflatex';
	const compiler =
		engine === 'xelatex' || engine === 'latex'
			? engine
			: engine === 'lualatex'
				? null
				: 'pdflatex';
	if (compiler === null) warnings.push('lualatex');
	if (folder) warnings.push('not-at-root');

	const bblPath = `${folder}${job}.bbl`;
	const bbl = generated.get(bblPath);
	const hasBib = input.files.some((file) => /\.bib$/i.test(file.path));
	if (hasBib && !bbl && !files.some((file) => file.path === bblPath)) {
		warnings.push('no-bbl');
	}
	const texLiveVersion = arxivTexLive(texLiveYearOf(input.log));
	const format = bbl ? bblFormatOf(new TextDecoder().decode(bbl)) : null;
	if (format && format !== BBL_FORMAT[texLiveVersion]) {
		warnings.push('biblatex-format');
	}
	if (input.status !== 0) warnings.push('compile-errors');

	// The author's own, if the project has one.
	if (!ownReadme) {
		const readme = {
			spec_version: 1,
			...(compiler ? { process: { compiler } } : {}),
			sources: [{ filename: main, usage: 'toplevel' }],
			texlive_version: texLiveVersion,
		};
		files.push({
			path: '00README.json',
			content: new TextEncoder().encode(`${JSON.stringify(readme, null, 2)}\n`),
		});
	}

	files.sort((a, b) => a.path.localeCompare(b.path));
	return { files, compiler, texLiveVersion, warnings };
};
