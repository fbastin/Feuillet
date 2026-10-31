import { commentService } from '@src/services/CommentService';
import { reviewService } from '@src/services/ReviewService';
import {
	type ReviewOverviewFile,
	filterOverview,
	reviewItemsOf,
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
			replies: 0,
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
					{ kind: 'comment', id: '1', line: 1, user: 'u', timestamp: 1, resolved: true, replies: 0 },
				],
			},
			{
				path: '/b.tex',
				fileId: 'b',
				items: [
					{ kind: 'change', id: '2', line: 4, user: 'u', timestamp: 1, resolved: false, replies: 1 },
				],
			},
		];

		expect(filterOverview(files, false).map((file) => file.path)).toEqual(['/b.tex']);
		expect(filterOverview(files, true).map((file) => file.path)).toEqual(['/a.tex']);
	});
});
