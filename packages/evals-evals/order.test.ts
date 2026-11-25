import { describe, expect, it } from "bun:test";
import { runOrder } from "./order";
import type { Priority } from "./scenario";

interface Item {
	id: string;
	priority?: Priority;
}

describe("runOrder", () => {
	it("orders by priority, then never run, then oldest last run", () => {
		const items: Item[] = [
			{ id: "low-never", priority: "low" },
			{ id: "normal-new" },
			{ id: "normal-old", priority: "normal" },
			{ id: "normal-never" },
			{ id: "high-recent", priority: "high" },
		];
		const last: Record<string, number> = {
			"normal-new": 300,
			"normal-old": 100,
			"high-recent": 500,
		};
		expect(
			runOrder(items, (each) => last[each.id]).map((each) => each.id),
		).toEqual([
			"high-recent",
			"normal-never",
			"normal-old",
			"normal-new",
			"low-never",
		]);
	});

	it("keeps the given order on ties and leaves its input alone", () => {
		const items: Item[] = [{ id: "b" }, { id: "a" }, { id: "c" }];
		expect(runOrder(items, () => undefined).map((each) => each.id)).toEqual([
			"b",
			"a",
			"c",
		]);
		expect(items.map((each) => each.id)).toEqual(["b", "a", "c"]);
	});
});
