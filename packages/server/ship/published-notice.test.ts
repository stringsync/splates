import { describe, expect, it } from "bun:test";
import type { CascadeStep } from "./cascade";
import { untilPublished } from "./published-notice";

const step = { publishes: ["a", "b"] } as CascadeStep;

describe("untilPublished", () => {
	it("shows a notice once every package is on the registry", async () => {
		let asked = 0;
		const shown: string[] = [];
		await untilPublished(
			{
				published: async () => ++asked > 3,
			},
			step,
			"1.0.1",
			{
				settled: () => false,
				pause: async () => {},
				show: async (notice) => {
					shown.push(notice);
				},
			},
		);
		expect(shown).toHaveLength(1);
		expect(shown[0]).toContain("a, b @1.0.1 on the registry");
	});

	it("shows nothing when the command ends first", async () => {
		const shown: string[] = [];
		await untilPublished({ published: async () => false }, step, "1.0.1", {
			settled: () => true,
			pause: async () => {},
			show: async (notice) => {
				shown.push(notice);
			},
		});
		expect(shown).toEqual([]);
	});
});
