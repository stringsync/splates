import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "../events";
import {
	cleanup,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's merge events", () => {
	let testing: Testing;
	let events: Event[];

	beforeEach(() => {
		testing = new Testing();
		events = [
			{
				id: "m1",
				at: second(3.5),
				action: "merge",
				task: "alpha",
				reason: "conflict",
				conversation: "c1",
				base: "main",
				files: ["a.ts"],
				attemptsLeft: 2,
			},
			{
				id: "m2",
				at: second(4),
				action: "merge",
				task: "alpha",
				reason: null,
				conversation: "c1",
				base: "main",
				commit: "abc1234",
				files: ["a.ts"],
				attemptsLeft: 2,
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("draws a merge as landed and a refused one as failed", async () => {
		const view = await testing.openConversations([
			{
				...turn([
					tool({
						id: "x1",
						command: "arbor merge",
						at: second(2),
						until: second(3),
					}),
					tool({
						id: "r1",
						kind: "read",
						paths: ["/repo/a.ts"],
						at: second(10),
						until: second(11),
					}),
					"Merging.",
				]),
				events,
			},
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Merge failedalpha",
			"Mergedalpha",
		]);
	});
});
