// src/utils/githubWorkflow.ts
// The GitHub Actions workflow that compiles the project on GitHub at each
// push and pull request, as Feuillet's server does: the same main document,
// engine and year of TeX Live (TeX Live's own Docker images), latexmk with
// glossaries and nomenclatures, shell escape. The PDF is kept as the run's
// artifact; errors make the run fail, as a check on pull requests.

export const WORKFLOW_PATH = '.github/workflows/feuillet.yml';
/** The first line of a workflow Feuillet wrote, and may rewrite. */
export const WORKFLOW_MARKER = '# Made by Feuillet';

export type WorkflowEngine = 'pdflatex' | 'latex' | 'lualatex' | 'xelatex';

export interface WorkflowSettings {
	/** In the repository, without a leading slash. */
	mainFile: string;
	engine: string;
	/** « latest », or a year that stays. */
	version: string;
	/** The newest TeX Live, which has no historic image yet. */
	latestYear: number | null;
}

const ENGINE_ARGS: Record<WorkflowEngine, string> = {
	pdflatex: '-pdf',
	latex: '-pdfps',
	lualatex: '-pdflua',
	xelatex: '-pdfxe',
};

const ENGINE_NAMES: Record<WorkflowEngine, string> = {
	pdflatex: 'pdfLaTeX',
	latex: 'LaTeX',
	lualatex: 'LuaLaTeX',
	xelatex: 'XeLaTeX',
};

/** The engine as the compile menu names it: « LuaLaTeX ». */
export const engineName = (engine: string): string =>
	ENGINE_NAMES[engineOf(engine)];

const engineOf = (engine: string): WorkflowEngine =>
	Object.hasOwn(ENGINE_ARGS, engine) ? (engine as WorkflowEngine) : 'pdflatex';

/**
 * TeX Live's image (hub.docker.com/r/texlive/texlive): « latest », or a
 * past year's « TLyyyy-historic » (2013 to the year before the newest).
 */
export const texliveImage = (
	version: string,
	latestYear: number | null,
): { image: string; label: string } => {
	const year = /^\d{4}$/.test(version) ? Number(version) : null;
	if (year === null || (latestYear !== null && year >= latestYear)) {
		return {
			image: 'texlive/texlive:latest',
			label:
				year !== null
					? `TeX Live ${year}, the newest: change to TL${year}-historic once TeX Live ${year + 1} is out`
					: 'the newest TeX Live',
		};
	}
	const kept = Math.max(2013, year);
	return {
		image: `texlive/texlive:TL${kept}-historic`,
		label: `TeX Live ${kept}`,
	};
};

// A shell word, quoted.
const shellQuote = (value: string): string =>
	`'${value.replaceAll("'", `'"'"'`)}'`;

/** The parts of the main file: its folder and its job name. */
const partsOf = (mainFile: string) => {
	const path = mainFile.replace(/^\/+/, '');
	const slash = path.lastIndexOf('/');
	const folder = slash < 0 ? '' : path.slice(0, slash);
	const file = slash < 0 ? path : path.slice(slash + 1);
	const job = file.replace(/\.[^.]+$/, '');
	return { path, folder, job };
};

/** The workflow file's text. */
export const buildWorkflow = (settings: WorkflowSettings): string => {
	const engine = engineOf(settings.engine);
	const { path, folder, job } = partsOf(settings.mainFile);
	const pdf = folder ? `${folder}/${job}.pdf` : `${job}.pdf`;
	const { image, label } = texliveImage(settings.version, settings.latestYear);
	// The Feuillet it was made on: this one.
	const site =
		typeof window === 'undefined'
			? 'https://feuillet.slashbin.net'
			: window.location.origin;
	return [
		WORKFLOW_MARKER,
		`# (${site}). It compiles the project on GitHub at`,
		'# each push and pull request, as Feuillet does: same main document,',
		'# engine and TeX Live. The PDF is in each run, under « Artifacts ».',
		"# Feuillet rewrites this file when the project's settings change.",
		'name: PDF',
		'',
		'on:',
		'  push:',
		'  pull_request:',
		'  workflow_dispatch:',
		'',
		'permissions:',
		'  contents: read',
		'',
		'jobs:',
		'  pdf:',
		'    runs-on: ubuntu-latest',
		`    # ${label}`,
		`    container: ${image}`,
		'    steps:',
		'      - uses: actions/checkout@v4',
		`      - name: ${JSON.stringify(`Compile ${path} with ${ENGINE_NAMES[engine]}`)}`,
		'        run: |',
		'          # Glossaries and nomenclatures, made between runs.',
		`          cat > "$RUNNER_TEMP/latexmkrc" <<'RC'`,
		"          add_cus_dep('glo', 'gls', 0, 'feuillet_glossaries');",
		"          add_cus_dep('acn', 'acr', 0, 'feuillet_glossaries');",
		"          add_cus_dep('slo', 'sls', 0, 'feuillet_glossaries');",
		"          add_cus_dep('nlo', 'nls', 0, 'feuillet_nomenclature');",
		"          sub feuillet_glossaries { return system('makeglossaries', $_[0]); }",
		"          sub feuillet_nomenclature { return system('makeindex', \"$_[0].nlo\", '-s', 'nomencl.ist', '-o', \"$_[0].nls\"); }",
		'          RC',
		`          latexmk -r "$RUNNER_TEMP/latexmkrc" -cd ${ENGINE_ARGS[engine]} -interaction=nonstopmode -file-line-error -shell-escape ${shellQuote(path)}`,
		'      - name: Keep the PDF',
		'        if: always()',
		'        uses: actions/upload-artifact@v4',
		'        with:',
		'          name: PDF',
		`          path: ${JSON.stringify(pdf)}`,
		'          if-no-files-found: warn',
		'',
	].join('\n');
};

/** Whether `text` is a workflow Feuillet wrote (and may rewrite). */
export const isFeuilletWorkflow = (text: string): boolean =>
	text.startsWith(WORKFLOW_MARKER);
