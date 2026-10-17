import { describe, expect, it } from "bun:test";
import { limited } from "./limited";

describe("limited", () => {
	it("keeps the items' order and runs no more than it is allowed at once", async () => {
		let running = 0;
		let most = 0;
		const doubled = await limited([5, 1, 4, 2, 3], 2, async (ms) => {
			running++;
			most = Math.max(most, running);
			await Bun.sleep(ms);
			running--;
			return ms * 2;
		});

		expect(doubled).toEqual([10, 2, 8, 4, 6]);
		expect(most).toBe(2);
	});

	it("runs nothing for no items", async () => {
		expect(await limited([], 4, async () => 1)).toEqual([]);
	});
});
