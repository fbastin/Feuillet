// src/utils/gitBranch.ts
// Branch names for the work on a branch (GitHubBranchSection): what Git
// accepts (git check-ref-format, simplified), and a name to start from.
import { t } from '@/i18n';

/** Why Git would refuse `name` as a branch, in words; null when it is fine. */
export const branchNameProblem = (name: string): string | null => {
	if (!name) return t('Give the branch a name.');
	if (name.length > 100)
		return t('The name is too long (100 characters at most).');
	if (/\s/.test(name)) return t('A branch name has no spaces: use - instead.');
	if (
		/[~^:?*[\\]/.test(name) ||
		[...name].some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		)
	)
		return t('A branch name cannot hold ~ ^ : ? * [ or \\.');
	if (
		/^[-/.]|[/.]$|\.\.|\/\/|@\{|\.lock$|\/\.|\.lock\//.test(name) ||
		name === '@'
	)
		return t(
			'Git refuses this name: no / or . at either end, no .. nor //, nothing ending in .lock.',
		);
	return null;
};

/** « feuillet-2026-11-06 », or « …-2 » and on when taken. */
export const suggestBranchName = (
	taken: readonly string[],
	date = new Date(),
): string => {
	const day = [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');
	const base = `feuillet-${day}`;
	const names = new Set(taken.map((name) => name.toLowerCase()));
	if (!names.has(base)) return base;
	for (let n = 2; ; n++) {
		if (!names.has(`${base}-${n}`)) return `${base}-${n}`;
	}
};
