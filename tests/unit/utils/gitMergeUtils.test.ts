import { autoMergeDriver, autoMergeText } from '@/utils/gitMergeUtils';

const comment = (text: string) =>
	`\`<### comment id: c1, user: tester, time: 1700000000000, content: 'a note', responses: [], resolved: false ###>\`${text}\`</### comment id: c1 ###>\``;

describe('autoMergeText', () => {
	it('merges changes on different lines, line endings kept', () => {
		expect(
			autoMergeText('main.tex', ['A\r\nB\r\nC\r\n', 'X\r\nA\r\nB\r\nC\r\n', 'A\r\nB\r\nC\r\nY\r\n']),
		).toEqual({ cleanMerge: true, mergedText: 'X\r\nA\r\nB\r\nC\r\nY\r\n' });
	});

	it('leaves the same line changed both ways', () => {
		expect(autoMergeText('main.tex', ['A\nB\n', 'A\nB1\n', 'A\nB2\n'])).toBeNull();
	});

	it('leaves binary files and texts with review tags to the merge window', () => {
		expect(autoMergeText('figure.png', ['a\n', 'b\na\n', 'a\nc\n'])).toBeNull();
		expect(
			autoMergeText('main.tex', [
				`${comment('A')}\nB\n`,
				`X\n${comment('A')}\nB\n`,
				`${comment('A')}\nB\nY\n`,
			]),
		).toBeNull();
	});
});

describe('autoMergeDriver', () => {
	it('says « not clean » with our text when it cannot merge', async () => {
		await expect(
			autoMergeDriver({ path: 'main.tex', contents: ['A\n', 'A1\n', 'A2\n'] }),
		).resolves.toEqual({ cleanMerge: false, mergedText: 'A1\n' });
	});
});
