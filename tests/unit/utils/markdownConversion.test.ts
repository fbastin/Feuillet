// Markdown with Pandoc (src/utils/markdownConversion.ts): the images that go
// with an exported project, and what a Markdown file to import says.
import {
	chooseMainMarkdown,
	collectMarkdownMedia,
	latexPathFor,
	markdownBody,
	markdownDeclaresLanguage,
	markdownTitle,
} from '@src/utils/markdownConversion';

describe('Markdown conversion', () => {
	const project = ['/main.tex', '/images/plot.png', '/images/logo.pdf', '/figures/diagram.svg', '/refs.bib'];

	it('finds the images the Markdown shows, adding the extensions LaTeX left out', () => {
		const { markdown, media } = collectMarkdownMedia(
			'![](images/plot.png)\n\n![Logo](images/logo "Le logo")\n\n![](diagram)\n\n![](https://example.org/x.png)\n\n![](missing.png)\n',
			'main.tex',
			project,
		);
		expect(media).toEqual(['figures/diagram.svg', 'images/logo.pdf', 'images/plot.png']);
		expect(markdown).toBe(
			'![](images/plot.png)\n\n![Logo](images/logo.pdf "Le logo")\n\n![](figures/diagram.svg)\n\n![](https://example.org/x.png)\n\n![](missing.png)\n',
		);
	});

	it('writes the links from the main file\'s folder', () => {
		const { markdown, media } = collectMarkdownMedia(
			'![](figs/a.png) ![](../shared/b) ![](<figs/with space.png>)',
			'/thesis/main.tex',
			['/thesis/main.tex', '/thesis/figs/a.png', '/shared/b.jpg', '/thesis/figs/with space.png'],
		);
		expect(media).toEqual(['shared/b.jpg', 'thesis/figs/a.png', 'thesis/figs/with space.png']);
		expect(markdown).toBe('![](figs/a.png) ![](../shared/b.jpg) ![](<figs/with space.png>)');
	});

	it('reads the title and the language of a YAML block', () => {
		const text = '---\ntitle: "Mes notes"\nlang: fr-CA\n---\n\n# Partie\n';
		expect(markdownTitle(text)).toBe('Mes notes');
		expect(markdownDeclaresLanguage(text)).toBe(true);
		expect(markdownBody(text)).toBe('\n# Partie\n');
		expect(markdownTitle('# Titre\n\n---\ntitle: non\n---\n')).toBeNull();
		expect(markdownDeclaresLanguage('# Titre')).toBe(false);
	});

	it('chooses the Markdown file an archive is about', () => {
		expect(chooseMainMarkdown(['/docs/a.md', '/README.md', '/notes.md'])).toBe('/README.md');
		expect(chooseMainMarkdown(['/b.md', '/a.markdown', '/img.png'])).toBe('/a.markdown');
		expect(chooseMainMarkdown(['/sub/main.md', '/x.md'])).toBe('/sub/main.md');
		expect(chooseMainMarkdown(['/img.png'])).toBeNull();
	});

	it('puts the LaTeX beside it, without replacing a file', () => {
		expect(latexPathFor('/notes.md', ['/notes.md'])).toBe('/main.tex');
		expect(latexPathFor('/notes.md', ['/notes.md', '/main.tex'])).toBe('/notes.tex');
		expect(latexPathFor('/docs/notes.md', ['/docs/main.tex', '/docs/notes.tex'])).toBe('/docs/notes-2.tex');
	});
});
