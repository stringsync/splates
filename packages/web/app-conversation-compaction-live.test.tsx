import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Compaction } from "@stringsync/splates-server/conversations";
import {
	cleanup,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's compaction while the turn goes on", () => {
	let testing: Testing;
	/** A turn still running whose last move, after a read, is a compaction. */
	let compaction: Compaction;

	beforeEach(() => {
		testing = new Testing();
		compaction = {
			type: "compaction",
			id: "c1",
			status: "in_progress",
			trigger: "automatic",
			before: null,
			after: null,
			summary: null,
			at: second(10),
			until: null,
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	// The thread of the running turn, as it stands once compacting.
	const opened = async () => {
		const live = turn(
			[
				tool({
					id: "r1",
					kind: "read",
					paths: ["/repo/a.ts"],
					until: second(5),
				}),
				compaction,
			],
			{ status: "running" },
		);
		const view = await testing.openConversations([live]);
		return await waitFor(() =>
			view.getByRole("region", { name: live.title ?? "" }),
		);
	};
	const lines = (thread: HTMLElement) =>
		[
			...thread.querySelectorAll(
				'[data-slot="work"] summary, [data-slot="compaction"]',
			),
		].map((each) => each.textContent);

	it("ends the work above a compaction still going, whose line says the agent is at work", async () => {
		const thread = await opened();

		await waitFor(() =>
			expect(lines(thread)).toEqual(["Worked 10s", "Compacting context"]),
		);
		expect(within(thread).getByText("Compacting context").className).toContain(
			"shimmer",
		);
	});

	it("says Working below a compaction that finished", async () => {
		compaction = {
			...compaction,
			status: "completed",
			before: 317_025,
			after: 8_589,
			until: second(84),
		};
		const thread = await opened();

		await waitFor(() => {
			const [above, line, below] = lines(thread);
			expect(above).toBe("Worked 10s");
			expect(line).toBe("Compacted context317k → 8.6k");
			expect(below).toMatch(/^Working/);
		});
	});
});
