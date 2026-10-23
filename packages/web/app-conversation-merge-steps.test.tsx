import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import {
	cleanup,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's merge steps", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The lines' words in a thread opened with `events`, its turn going or not. */
	const lines = async (events: Event[], count: number, going = true) => {
		const view = await testing.openConversations([
			{
				...turn(
					[
						tool({
							id: "x1",
							command: "splates merge",
							status: going ? "in_progress" : "completed",
							at: second(2),
						}),
					],
					{ status: going ? "running" : "idle" },
				),
				events,
			},
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);
		return await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(count);
			return found.map((line) => line.textContent);
		});
	};

	it("counts up while queued, then keeps the wait once started", async () => {
		expect(await lines([queued()], 1)).toEqual([
			expect.stringMatching(/^Merge queuedalpha\d+:\d\d$/),
		]);
		cleanup();
		expect(await lines([queued(), started("q1", second(65))], 2)).toEqual([
			"Merge queuedalpha· waited 1m",
			expect.stringMatching(/^Merge startedalpha\d+:\d\d$/),
		]);
	});

	it("turns the started line into how the merge ended and how long it ran", async () => {
		expect(
			await lines(
				[started(null, second(5)), merged("s1", second(105), null)],
				1,
				false,
			),
		).toEqual(["Mergedalphain 1m 40s"]);
		cleanup();
		expect(
			await lines(
				[
					queued(),
					started("q1", second(35)),
					merged("q1", second(80), "tests_failed"),
				],
				2,
				false,
			),
		).toEqual(["Merge queuedalpha· waited 30s", "Merge failedalphain 45sWhy"]);
	});

	it("says a merge whose turn ended without its end was interrupted", async () => {
		expect(await lines([queued()], 1, false)).toEqual([
			"Merge interruptedalpha",
		]);
	});
});

function queued(): Event {
	return {
		id: "q1",
		at: second(5),
		action: "merge queued",
		task: "alpha",
		reason: null,
		conversation: "c1",
	};
}

function started(began: string | null, at: string): Event {
	return {
		id: "s1",
		at,
		action: "merge start",
		task: "alpha",
		reason: null,
		conversation: "c1",
		began,
	};
}

function merged(began: string, at: string, reason: string | null): Event {
	const facts = {
		base: "main",
		files: ["a.ts"],
		attemptsLeft: 2,
		failedTests: [],
		began,
	};
	return reason === null
		? {
				id: "m1",
				at,
				action: "merge",
				task: "alpha",
				reason,
				conversation: "c1",
				commit: "abc1234",
				...facts,
			}
		: {
				id: "m1",
				at,
				action: "merge",
				task: "alpha",
				reason,
				conversation: "c1",
				...facts,
			};
}
