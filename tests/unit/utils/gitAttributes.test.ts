import { isLfsPointer, lfsMatcher } from '@/utils/gitAttributes';

const encode = (text: string) => new TextEncoder().encode(text);

describe('lfsMatcher', () => {
	it('matches a name without a slash in any folder', () => {
		const matches = lfsMatcher('*.png filter=lfs diff=lfs merge=lfs -text\n');
		expect(matches('logo.png')).toBe(true);
		expect(matches('images/deep/logo.png')).toBe(true);
		expect(matches('main.tex')).toBe(false);
		expect(matches('logo.png.txt')).toBe(false);
	});

	it('anchors a pattern with a slash to the file’s folder', () => {
		const matches = lfsMatcher('images/*.pdf filter=lfs\n/data/** filter=lfs\n');
		expect(matches('images/plan.pdf')).toBe(true);
		expect(matches('other/images/plan.pdf')).toBe(false);
		expect(matches('images/sub/plan.pdf')).toBe(false);
		expect(matches('data/a/b/c.bin')).toBe(true);
	});

	it('reads a nested .gitattributes relative to its folder', () => {
		const matches = lfsMatcher('*.zip filter=lfs\n', 'annexes');
		expect(matches('annexes/code.zip')).toBe(true);
		expect(matches('annexes/sub/code.zip')).toBe(true);
		expect(matches('code.zip')).toBe(false);
	});

	it('lets a later line take a file back, and skips comments and other attributes', () => {
		const matches = lfsMatcher(
			'# images\n*.png filter=lfs\nicons/*.png -filter\n*.tex text eol=lf\n',
		);
		expect(matches('logo.png')).toBe(true);
		expect(matches('icons/small.png')).toBe(false);
		expect(matches('main.tex')).toBe(false);
	});

	it('handles ?, ** and character classes', () => {
		const matches = lfsMatcher('fig?.[pj][np]g filter=lfs\n**/raw/* filter=lfs\n');
		expect(matches('fig1.png')).toBe(true);
		expect(matches('fig2.jpg')).toBe(true);
		expect(matches('fig10.png')).toBe(false);
		expect(matches('a/b/raw/x.dat')).toBe(true);
		expect(matches('raw/x.dat')).toBe(true);
	});
});

describe('isLfsPointer', () => {
	it('tells a pointer from the file itself', () => {
		expect(
			isLfsPointer(
				encode(
					'version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12345\n',
				),
			),
		).toBe(true);
		expect(isLfsPointer(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
		expect(
			isLfsPointer(encode(`version https://git-lfs.github.com/spec/v1${' '.repeat(2000)}`)),
		).toBe(false);
	});
});
