import { commentService } from '@src/services/CommentService';
import { reviewService } from '@src/services/ReviewService';
import { stripAnnotations } from '@src/utils/fileCommentUtils';
import {
	type ReviewOverviewFile,
	decideAllChanges,
	addReply,
	decideChange,
	deleteReply,
	filterOverview,
	reviewItemsOf,
	setCommentResolved,
} from '@src/utils/reviewOverview';

const comment = (text: string, content: string, user = 'alice') => {
	const raw = commentService.addComment(content, user);
	return `${raw.openTag}${text}${raw.closeTag}`;
};
const change = (original: string, current: string, user = 'bob') => {
	const raw = reviewService.createReview(original, user);
	return `${raw.openTag}${current}${raw.closeTag}`;
};

describe('the review overview', () => {
	it("lists a file's comments and changes in the order of the text", () => {
		const text = [
			'\\section{Introduction}',
			`Un ${comment('passage à revoir', 'Vérifier ce passage.')} ici.`,
			`Le ${change('', 'nouveau ')}texte, ${change('ancien', '')} et ${change('rouge', 'bleu')}.`,
		].join('\n');

		const items = reviewItemsOf(text);

		expect(items.map((item) => [item.kind, item.line])).toEqual([
			['comment', 2],
			['change', 3],
			['change', 3],
			['change', 3],
		]);
		expect(items[0]).toMatchObject({
			user: 'alice',
			content: 'Vérifier ce passage.',
			quoted: 'passage à revoir',
			resolved: false,
			replies: [],
		});
		expect(items.slice(1).map((item) => [item.change, item.removed, item.added])).toEqual(
			expect.arrayContaining([
				['inserted', '', 'nouveau '],
				['deleted', 'ancien', ''],
				['replaced', 'rouge', 'bleu'],
			]),
		);
		expect(reviewItemsOf('Sans annotation.')).toEqual([]);
	});

	it('shows the active items or the resolved ones, of files having any', () => {
		const files: ReviewOverviewFile[] = [
			{
				path: '/a.tex',
				fileId: 'a',
				items: [
					{ kind: 'comment', id: '1', line: 1, user: 'u', timestamp: 1, resolved: true, replies: [] },
				],
			},
			{
				path: '/b.tex',
				fileId: 'b',
				items: [
					{ kind: 'change', id: '2', line: 4, user: 'u', timestamp: 1, resolved: false, replies: [] },
				],
			},
		];

		expect(filterOverview(files, false).map((file) => file.path)).toEqual(['/b.tex']);
		expect(filterOverview(files, true).map((file) => file.path)).toEqual(['/a.tex']);
	});

	describe('decides from the overview, on the whole text', () => {
		const text = `Le ${change('', 'nouveau ')}texte, ${change('ancien', '')} et ${change('rouge', 'bleu')}; ${comment('ici', 'À voir.')}.`;
		const ids = reviewItemsOf(text).filter((item) => item.kind === 'change').map((item) => item.id);
		const commentId = reviewItemsOf(text).find((item) => item.kind === 'comment')?.id ?? '';
		const plain = (value: string) => stripAnnotations(value) as string;

		it('accepts or rejects one change', () => {
			const accepted = decideChange(text, ids[2], true);
			expect(plain(accepted)).toBe('Le nouveau texte,  et bleu; ici.');
			expect(reviewItemsOf(accepted).filter((item) => item.kind === 'change')).toHaveLength(2);
			expect(plain(decideChange(text, ids[2], false))).toBe('Le nouveau texte,  et rouge; ici.');
			expect(decideChange(text, 'gone', true)).toBe(text);
		});

		it('accepts or rejects them all, leaving the comments', () => {
			const accepted = decideAllChanges(text, true);
			expect(accepted).not.toContain('review id:');
			expect(plain(accepted)).toBe('Le nouveau texte,  et bleu; ici.');
			expect(plain(decideAllChanges(text, false))).toBe('Le texte, ancien et rouge; ici.');
			expect(reviewItemsOf(decideAllChanges(text, false)).map((item) => item.kind)).toEqual(['comment']);
		});

		it('answers a comment or a change, and takes an answer back', () => {
			const answered = addReply(text, 'comment', commentId, 'Fait, merci.', 'bob');
			const item = reviewItemsOf(answered).find((entry) => entry.id === commentId);
			expect(item?.replies).toEqual([
				expect.objectContaining({ user: 'bob', content: 'Fait, merci.' }),
			]);
			expect(plain(answered)).toBe(plain(text));
			const reply = item?.replies[0].id ?? '';
			expect(deleteReply(answered, 'comment', commentId, reply)).toBe(text);

			const onChange = addReply(text, 'change', ids[0], "D'accord.", 'alice');
			expect(
				reviewItemsOf(onChange).find((entry) => entry.id === ids[0])?.replies,
			).toEqual([expect.objectContaining({ user: 'alice', content: "D'accord." })]);
			expect(addReply(text, 'comment', 'gone', 'x', 'bob')).toBe(text);
		});

		it('resolves a comment and opens it again', () => {
			const resolved = setCommentResolved(text, commentId, true);
			const item = reviewItemsOf(resolved).find((entry) => entry.id === commentId);
			expect(item).toMatchObject({ resolved: true, content: 'À voir.', quoted: 'ici' });
			expect(plain(resolved)).toBe(plain(text));
			expect(setCommentResolved(resolved, commentId, false)).toBe(text);
			expect(setCommentResolved(text, commentId, false)).toBe(text);
		});
	});
});
