import { forEachLimited } from '../../../src/utils/asyncLimit';

describe('forEachLimited', () => {
	it('runs every item, never more than the limit at once', async () => {
		let running = 0;
		let most = 0;
		const done: number[] = [];
		await forEachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
			running++;
			most = Math.max(most, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			done.push(item);
			running--;
		});
		expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(most).toBe(3);
	});

	it('spaces the starts: no faster on the whole than one per spacing', async () => {
		const starts: number[] = [];
		await forEachLimited([1, 2, 3, 4], 4, async () => {
			starts.push(Date.now());
		}, 20);
		// A late timer may bring two starts closer; the rate stays bounded.
		expect(starts[starts.length - 1] - starts[0]).toBeGreaterThanOrEqual(58);
	});

	it('stops at the first error and throws it', async () => {
		const seen: number[] = [];
		await expect(
			forEachLimited([1, 2, 3, 4, 5], 1, async (item) => {
				seen.push(item);
				if (item === 2) throw new Error('refused');
			}),
		).rejects.toThrow('refused');
		expect(seen).toEqual([1, 2]);
	});

	it('does nothing for no items', async () => {
		const task = jest.fn();
		await forEachLimited([], 4, task);
		expect(task).not.toHaveBeenCalled();
	});
});
