import {
	arxivGeneratedPaths,
	buildArxivPackage,
	mainFileParts,
	texLiveYearOf,
} from '@src/utils/arxivPackage';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (content: Uint8Array) => new TextDecoder().decode(content);
const LOG = 'This is pdfTeX, Version 3.141592653-2.6-1.40.27 (TeX Live 2025) (preloaded format=pdflatex)';
const BIBTEX_BBL = '\\begin{thebibliography}{1}\n\\bibitem{knuth} D. Knuth.\n\\end{thebibliography}\n';
const BIBLATEX_BBL = (format: string) => `% $ biblatex auxiliary file $\n% $ biblatex bbl format version ${format} $\n\\refsection{0}\n`;

const project = [
	{ path: '/main.tex', content: bytes('\\documentclass{article}') },
	{ path: '/refs.bib', content: bytes('@book{knuth}') },
	{ path: '/figures/plot.pdf', content: bytes('%PDF-1.5') },
	{ path: '/main.pdf', content: bytes('%PDF-old') },
	{ path: '/main.aux', content: bytes('\\relax') },
	{ path: '/main.bbl', content: bytes('old bbl') },
	{ path: '/.feuillet/links.json', content: bytes('{}') },
	{ path: '/notes/.draft.tex', content: bytes('secret') },
];

describe('package for arXiv', () => {
	it('names what the compile writes after the main file', () => {
		expect(mainFileParts('/main.tex')).toEqual({ folder: '', job: 'main' });
		expect(mainFileParts('/these/these.tex')).toEqual({ folder: 'these/', job: 'these' });
		expect(arxivGeneratedPaths('/main.tex')).toEqual(['main.bbl', 'main.ind', 'main.gls', 'main.acr', 'main.sls', 'main.nls']);
		expect(arxivGeneratedPaths('these/these.tex')[0]).toBe('these/these.bbl');
		expect(texLiveYearOf(LOG)).toBe(2025);
		expect(texLiveYearOf('no year')).toBeNull();
	});

	it('holds the sources and the new .bbl, not what compiling writes nor hidden files', () => {
		const made = buildArxivPackage({
			mainFile: '/main.tex',
			engine: 'pdflatex',
			files: project,
			generated: [{ path: 'main.bbl', content: bytes(BIBTEX_BBL) }],
			log: LOG,
			status: 0,
		});
		expect(made.files.map((f) => f.path)).toEqual([
			'00README.json',
			'figures/plot.pdf',
			'main.bbl',
			'main.tex',
			'refs.bib',
		]);
		expect(text(made.files.find((f) => f.path === 'main.bbl')!.content)).toBe(BIBTEX_BBL);
		expect(made.warnings).toEqual([]);
		expect(JSON.parse(text(made.files[0].content))).toEqual({
			spec_version: 1,
			process: { compiler: 'pdflatex' },
			sources: [{ filename: 'main.tex', usage: 'toplevel' }],
			texlive_version: 2025,
		});
	});

	it('asks for the TeX Live arXiv has nearest to the one that compiled', () => {
		const make = (log: string) => buildArxivPackage({ mainFile: 'main.tex', engine: 'xelatex', files: project.slice(0, 1), generated: [], log, status: 0 });
		expect(make('(TeX Live 2023/Debian)').texLiveVersion).toBe(2023);
		expect(make('(TeX Live 2026)').texLiveVersion).toBe(2025);
		expect(make('').texLiveVersion).toBe(2025);
		expect(make(LOG).compiler).toBe('xelatex');
	});

	it('says what arXiv may refuse', () => {
		const lua = buildArxivPackage({ mainFile: '/these/these.tex', engine: 'lualatex', files: [{ path: '/these/these.tex', content: bytes('x') }, { path: '/refs.bib', content: bytes('@book{a}') }], generated: [], log: LOG, status: 1 });
		expect(lua.warnings).toEqual(['lualatex', 'not-at-root', 'no-bbl', 'compile-errors']);
		const readme = JSON.parse(text(lua.files.find((f) => f.path === '00README.json')!.content));
		expect(readme.process).toBeUndefined();
		expect(readme.sources).toEqual([{ filename: 'these/these.tex', usage: 'toplevel' }]);

		const biber = (format: string, log: string) => buildArxivPackage({ mainFile: 'main.tex', engine: 'pdflatex', files: project.slice(0, 2), generated: [{ path: 'main.bbl', content: bytes(BIBLATEX_BBL(format)) }], log, status: 0 }).warnings;
		expect(biber('3.3', LOG)).toEqual([]);
		expect(biber('3.2', '(TeX Live 2023)')).toEqual([]);
		expect(biber('3.2', LOG)).toEqual(['biblatex-format']);
	});

	it("keeps the author's own 00README", () => {
		const made = buildArxivPackage({ mainFile: 'main.tex', engine: 'pdflatex', files: [...project.slice(0, 1), { path: '/00README.XXX', content: bytes('main.tex toplevelfile') }], generated: [], log: LOG, status: 0 });
		expect(made.files.map((f) => f.path)).toEqual(['00README.XXX', 'main.tex']);
	});
});
