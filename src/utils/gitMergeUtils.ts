// src/utils/gitMergeUtils.ts
// A file both sides of a merge changed: merged on its own when the changes
// touch different lines (diff3, as Git does), else left to the merge window.
// Binary files, and texts holding review tags (comments, tracked changes),
// always go to the window, which knows how to keep the tags.
import { isBinaryFile } from './fileUtils';
import { hasAnnotations } from './fileCommentUtils';
import { threeWayMerge } from './textDiffUtils';

export interface MergeDriverResult {
	cleanMerge: boolean;
	mergedText: string;
}

/** contents: [base, ours, theirs], as isomorphic-git's merge driver gets them. */
export const autoMergeText = (
	path: string,
	contents: string[],
): MergeDriverResult | null => {
	if (isBinaryFile(path)) return null;
	const [base = '', ours = '', theirs = ''] = contents;
	if ([base, ours, theirs].some((text) => hasAnnotations(text))) return null;
	const { merged, hasConflicts } = threeWayMerge(base, ours, theirs);
	return hasConflicts ? null : { cleanMerge: true, mergedText: merged };
};

/**
 * The driver for the merge itself: the same decision as the dry run that
 * looked for conflicts, so what it found clean merges clean.
 */
export const autoMergeDriver = async ({
	path,
	contents,
}: {
	path: string;
	contents: string[];
}): Promise<MergeDriverResult> =>
	autoMergeText(path, contents) ?? {
		cleanMerge: false,
		mergedText: contents[1] ?? '',
	};
