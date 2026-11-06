import {
	ENGINE_OF,
	dataUrlBytes,
	describeSource,
	githubRepositoryOf,
	isZip,
	mainDocumentOf,
	openLinkIdOf,
	parseOpenLinkRequest,
	projectNameOf,
	safeFileName,
	sourceFileName,
	wrapSnippet,
} from '../../../src/utils/openLink';

const ID = 'abcdefghijklmnopqrstuvwxyzABCDEF';

describe('« Ouvrir dans Feuillet » links', () => {
	it('reads the kept request from the address', () => {
		expect(openLinkIdOf(`#open:${ID}`)).toBe(ID);
		expect(openLinkIdOf(`open:${ID}`)).toBe(ID);
		expect(openLinkIdOf('#open:short')).toBeNull();
		expect(openLinkIdOf(`#yjs:${ID}`)).toBeNull();
	});

	it('checks what the server keeps', () => {
		expect(
			parseOpenLinkRequest({
				sources: [{ text: 'x' }, { uri: 'https://a.example/b.tex' }],
				names: ['a.tex', 3],
				engine: 'latex_dvipdf',
				mainDocument: 'a.tex',
				visualEditor: true,
			}),
		).toEqual({
			sources: [{ text: 'x' }, { uri: 'https://a.example/b.tex' }],
			names: ['a.tex'],
			engine: 'latex_dvipdf',
			mainDocument: 'a.tex',
			visualEditor: true,
		});
		expect(parseOpenLinkRequest({ sources: [] })).toBeNull();
		expect(parseOpenLinkRequest({ sources: [{ uri: 'javascript:x' }] })).toBeNull();
		expect(parseOpenLinkRequest(null)).toBeNull();
		expect(
			parseOpenLinkRequest({ sources: [{ text: 'x' }], engine: 'context' }),
		).toEqual({ sources: [{ text: 'x' }], names: [] });
	});

	it("maps Overleaf's compilers to TeX Live's here", () => {
		expect(ENGINE_OF.latex_dvipdf).toBe('latex');
		expect(ENGINE_OF.pdflatex).toBe('pdflatex');
		expect(ENGINE_OF.xelatex).toBe('xelatex');
		expect(ENGINE_OF.lualatex).toBe('lualatex');
	});

	it('names files from the link, the address or their kind', () => {
		expect(sourceFileName({ text: 'x' }, 0, undefined)).toBe('main.tex');
		expect(sourceFileName({ text: 'x' }, 1, undefined)).toBe('file2.tex');
		expect(sourceFileName({ text: 'x' }, 0, 'chapitre.tex')).toBe('chapitre.tex');
		expect(sourceFileName({ text: 'x' }, 0, '../../etc/passwd')).toBe('passwd');
		expect(
			sourceFileName({ uri: 'https://texample.net/files/rotated%20triangle.tex' }, 0, undefined),
		).toBe('rotated triangle.tex');
		expect(sourceFileName({ uri: 'https://a.example/' }, 2, undefined)).toBe('file3.tex');
		expect(
			sourceFileName({ uri: 'data:application/zip;base64,UEsDBA==' }, 0, undefined),
		).toBe('file1.zip');
		expect(sourceFileName({ uri: 'data:application/x-tex;base64,eA==' }, 0, undefined)).toBe(
			'main.tex',
		);
		expect(safeFileName('..hidden')).toBe('hidden');
		expect(safeFileName('a<b>:c?.tex')).toBe('abc.tex');
	});

	it('decodes data: URLs', () => {
		expect(new TextDecoder().decode(dataUrlBytes('data:application/x-tex;base64,aMOp'))).toBe('hé');
		expect(new TextDecoder().decode(dataUrlBytes('data:,50%25%20done'))).toBe('50% done');
		expect(() => dataUrlBytes('data:nothing')).toThrow();
	});

	it('tells archives by name or content', () => {
		expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]), 'HEAD')).toBe(true);
		expect(isZip(new Uint8Array([1, 2, 3, 4]), 'a.ZIP')).toBe(true);
		expect(isZip(new TextEncoder().encode('\\documentclass'), 'a.tex')).toBe(false);
	});

	it("wraps code without \\documentclass in Overleaf's preamble", () => {
		const wrapped = wrapSnippet('\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}\n\n');
		expect(wrapped.startsWith('\\documentclass[12pt]{article}\n\\usepackage[english]{babel}\n\\usepackage{amsmath}\n\\usepackage{tikz}\n\\begin{document}\n')).toBe(true);
		expect(wrapped.endsWith('\\end{tikzpicture}\n\\end{document}\n')).toBe(true);
	});

	it('names the project after a GitHub repository, the main file or the title', () => {
		expect(githubRepositoryOf('https://github.com/fbastin/Feuillet/archive/HEAD.zip')).toBe('Feuillet');
		expect(githubRepositoryOf('https://codeload.github.com/o/these/zip/refs/heads/main')).toBe('these');
		expect(githubRepositoryOf('https://github.com/o/r/blob/main/a.tex')).toBeNull();
		const fallback = 'LaTeX snippet';
		expect(projectNameOf({ sources: [{ uri: 'https://github.com/o/these/archive/HEAD.zip' }], names: [] }, fallback)).toBe('these');
		expect(projectNameOf({ sources: [{ uri: 'https://a.example/x/article.tex' }], names: [] }, fallback)).toBe('article');
		expect(projectNameOf({ sources: [{ text: '\\title{Mon article}' }], names: [] }, fallback)).toBe('Mon article');
		expect(projectNameOf({ sources: [{ text: 'x' }], names: [] }, fallback)).toBe(fallback);
		expect(projectNameOf({ sources: [{ text: 'x' }], names: ['note.tex'] }, fallback)).toBe('note');
		expect(projectNameOf({ sources: [{ text: 'x' }], names: [], mainDocument: 'these.tex' }, fallback)).toBe('these');
	});

	it('chooses the main document as asked, else the document', () => {
		const files = [
			{ path: '/chap.tex', text: '\\section{A}' },
			{ path: '/paper.tex', text: '\\documentclass{article}' },
			{ path: '/sub/other.tex', text: '\\documentclass{article}' },
			{ path: '/refs.bib' },
		];
		expect(mainDocumentOf(files, 'sub/other.tex')).toBe('/sub/other.tex');
		expect(mainDocumentOf(files, 'other.tex')).toBe('/sub/other.tex');
		expect(mainDocumentOf(files, 'missing.tex')).toBe('/paper.tex');
		expect(mainDocumentOf(files, undefined)).toBe('/paper.tex');
		expect(mainDocumentOf([...files, { path: '/main.tex', text: '\\documentclass{book}' }], undefined)).toBe('/main.tex');
		expect(mainDocumentOf([{ path: '/a.tex', text: '% \\documentclass{x}' }], undefined)).toBeUndefined();
	});

	it('describes sources for the dialog', () => {
		expect(describeSource({ text: 'a\nb\nc' })).toEqual({ kind: 'text', lines: 3 });
		expect(describeSource({ uri: 'https://texample.net/a.tex' })).toEqual({ kind: 'uri', host: 'texample.net' });
		expect(describeSource({ uri: 'data:,x' })).toEqual({ kind: 'uri', host: '' });
	});
});
