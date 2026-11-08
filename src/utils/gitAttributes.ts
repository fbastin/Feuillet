// src/utils/gitAttributes.ts
// Which files a repository keeps with Git LFS: the `filter=lfs` lines of its
// .gitattributes files, and the pointer such a file holds in Git in place
// of its content (https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md).

const LFS_POINTER_START = 'version https://git-lfs.github.com/spec/v1';
/** A pointer is a few lines of text: anything longer is a real file. */
const LFS_POINTER_MAX_SIZE = 1024;

const escapeRegExp = (text: string): string =>
	text.replace(/[.+^${}()|\\]/g, '\\$&');

// A .gitattributes pattern, as Git reads it: without a slash it matches a
// name in any folder below, with one it is relative to the file's folder.
const patternToRegExp = (pattern: string, folder: string): RegExp => {
	const anchored = pattern.replace(/\/+$/, '').includes('/');
	const body = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
	let source = '';
	for (let index = 0; index < body.length; index += 1) {
		const char = body[index];
		if (char === '*' && body[index + 1] === '*') {
			const slashAfter = body[index + 2] === '/';
			source += slashAfter ? '(?:.*/)?' : '.*';
			index += slashAfter ? 2 : 1;
		} else if (char === '*') {
			source += '[^/]*';
		} else if (char === '?') {
			source += '[^/]';
		} else if (char === '[') {
			const end = body.indexOf(']', index + 1);
			if (end < 0) {
				source += '\\[';
			} else {
				source += `[${body
					.slice(index + 1, end)
					.replace(/^!/, '^')
					.replace(/\\/g, '\\\\')}]`;
				index = end;
			}
		} else {
			source += escapeRegExp(char);
		}
	}
	const prefix = folder ? `${escapeRegExp(folder)}/` : '';
	return new RegExp(`^${prefix}${anchored ? '' : '(?:.*/)?'}${source}$`);
};

/**
 * The paths a .gitattributes file in `folder` ("" for the root) sends to
 * Git LFS, as a test on a repository path (no leading slash).
 */
export const lfsMatcher = (
	text: string,
	folder = '',
): ((path: string) => boolean) => {
	const tests: Array<{ pattern: RegExp; lfs: boolean }> = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const [pattern, ...attributes] = line.split(/\s+/);
		if (!pattern || pattern.startsWith('!')) continue;
		const filter = attributes.find(
			(attribute) =>
				attribute.startsWith('filter=') ||
				attribute === '-filter' ||
				attribute === '!filter',
		);
		if (!filter) continue;
		tests.push({
			pattern: patternToRegExp(pattern, folder),
			lfs: filter === 'filter=lfs',
		});
	}
	// As in Git, the last line that matches decides.
	return (path) => {
		let lfs = false;
		for (const test of tests) {
			if (test.pattern.test(path)) lfs = test.lfs;
		}
		return lfs;
	};
};

/** Whether `content` is a Git LFS pointer, not the file itself. */
export const isLfsPointer = (content: Uint8Array): boolean => {
	if (content.length > LFS_POINTER_MAX_SIZE) return false;
	return new TextDecoder()
		.decode(content.subarray(0, LFS_POINTER_START.length))
		.startsWith(LFS_POINTER_START);
};
