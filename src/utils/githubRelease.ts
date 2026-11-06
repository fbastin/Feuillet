// src/utils/githubRelease.ts
// « Publier une version sur GitHub »: the tag to suggest, whether a tag
// name is one Git takes, and the name of the attached PDF.
import { outputFileName } from './fileImportUtils';

/** The tag after the latest one: v3 after v2, 1.4 after 1.3, else v1. */
export const nextReleaseTag = (latest: string | null): string => {
	const tag = latest?.trim() ?? '';
	const numbers = /^(.*?)(\d+)$/.exec(tag);
	if (!numbers) return 'v1';
	return `${numbers[1]}${Number(numbers[2]) + 1}`;
};

/** Why Git would refuse this tag name (git check-ref-format), or null. */
export const tagNameProblem = (tag: string): 'empty' | 'invalid' | null => {
	if (!tag) return 'empty';
	if (
		tag.length > 200 ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: refused by Git
		/[\u0000- \u007f~^:?*[\\]/.test(tag) ||
		tag.includes('..') ||
		tag.includes('@{') ||
		tag === '@' ||
		tag.startsWith('-') ||
		tag.startsWith('/') ||
		tag.endsWith('/') ||
		tag.endsWith('.') ||
		tag.endsWith('.lock') ||
		tag.includes('//') ||
		tag.split('/').some((part) => part.startsWith('.'))
	) {
		return 'invalid';
	}
	return null;
};

/** « these-v2.pdf »: the project's PDF name with the tag. */
export const releaseAssetName = (projectName: string, tag: string): string => {
	const base = outputFileName(projectName).replace(/\.pdf$/, '');
	const suffix = tag.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
	return `${base}${suffix ? `-${suffix}` : ''}.pdf`;
};
