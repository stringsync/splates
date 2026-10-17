/**
 * `each` of `items`, in their order, with at most `concurrency` under way at
 * once: `Promise.all` for work that starts processes, which a long list would
 * otherwise start all together.
 */
export async function limited<T, R>(
	items: readonly T[],
	concurrency: number,
	each: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			results[index] = await each(items[index] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, worker),
	);
	return results;
}

/** How many tasks to read at once, each read running several git processes. */
export const READ_CONCURRENCY = 8;
