// src/utils/asyncLimit.ts
// Work on many items with a few requests at a time, as a Git host wants
// it: GitHub refuses, for a while, more than 100 requests at once or more
// than 900 points a minute (its secondary rate limits).

/**
 * Runs `task` on every item, `limit` at a time, each starting at least
 * `spacing` ms after the one before; stops at the first error, which it
 * throws.
 */
export const forEachLimited = async <T>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<void>,
	spacing = 0,
): Promise<void> => {
	let next = 0;
	let failed = false;
	let slot = 0;
	const worker = async () => {
		while (!failed && next < items.length) {
			const item = items[next++];
			const now = Date.now();
			slot = Math.max(slot + spacing, now);
			if (slot > now) {
				await new Promise((resolve) => setTimeout(resolve, slot - now));
			}
			try {
				await task(item);
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
};
