import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import {
	cleanup,
	details,
	fireEvent,
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

	/** A thread whose merge ended in `end`, which kept its steps, and the card it draws. */
	const openEnded = async (end: Event) => {
		const view = await testing.openConversations([
			{
				...turn(["Merging."], { status: "idle" }),
				events: [queued(), started("q1", second(35)), timed(end)],
			},
		]);
		return {
			view,
			card: await waitFor(() => view.getByRole("region", { name: "Merge" })),
		};
	};

	it("names queued and started merges without inline durations", async () => {
		expect(await lines([queued()], 1)).toEqual(["Queuedalpha"]);
		cleanup();
		expect(await lines([queued(), started("q1", second(65))], 2)).toEqual([
			"Queuedalpha",
			"Mergingalpha",
		]);
	});

	it("turns the started line into its outcome", async () => {
		expect(
			await lines(
				[started(null, second(5)), merged("s1", second(105), null)],
				1,
				false,
			),
		).toEqual(["Mergedalpha"]);
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
		).toEqual(["Queuedalpha", "Merge failedalpha"]);
	});

	it("draws a merge whose event kept its steps as a card: folded once landed, open with Why once refused", async () => {
		const landed = await openEnded(merged("q1", second(105), null));
		expect(landed.card.textContent).toContain("Merged in 1m 40s");
		expect(within(landed.card).queryByRole("list")).toBeNull();
		cleanup();

		const { view, card } = await openEnded(
			merged("q1", second(105), "tests_failed"),
		);
		expect(card.textContent).toContain("Merge failed in 1m 40s");
		expect(
			within(card).getByRole("listitem", { name: "Premerge, failed" }),
		).toBeTruthy();
		fireEvent.click(within(card).getByRole("button", { name: "Why" }));
		expect(
			(await waitFor(() => view.getByRole("dialog"))).textContent,
		).toContain("The merge gate's tests failed");
	});

	it("folds a refused merge's card once a later attempt follows it", async () => {
		const view = await testing.openConversations([
			{
				...turn(["Merging."], { status: "idle" }),
				events: [
					queued(),
					started("q1", second(35)),
					timed(merged("q1", second(105), "tests_failed")),
					{ ...started(null, second(200)), id: "s2" },
				],
			},
		]);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "Merge" }),
		);

		expect(card.textContent).toContain("Merge failed in 1m 40s");
		expect(within(card).queryByRole("list")).toBeNull();
	});

	it("draws the conversation's task merging as a live card whose premerge opens what it prints", async () => {
		const view = await testing.openConversations(
			[
				{
					...turn(
						[
							tool({
								id: "x1",
								command: "splates merge",
								status: "in_progress",
								at: second(2),
							}),
						],
						{ status: "running" },
					),
					task: "alpha",
					name: "Landing",
					events: [started(null, second(5))],
				},
			],
			"c1",
			{
				tasks: [
					details({
						task: "alpha",
						lease: "held",
						base: "main",
						gate: "running",
						mergeSince: second(5),
						mergeSteps: {
							steps: [
								{ step: "rebase", at: second(5) },
								{ step: "test", at: second(9), output: "/g/1-test.log" },
							],
						},
					}),
				],
			},
		);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "Merge" }),
		);
		expect(card.textContent).toContain("Merging");

		fireEvent.click(within(card).getByRole("button", { name: /Premerge/ }));
		const pane = await waitFor(() =>
			view.getByRole("complementary", { name: "merge step output" }),
		);
		expect(pane.textContent).toContain("Premerge");
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

/** `event` as a merge event that kept each step's time. */
function timed(event: Event): Event {
	return { ...event, stepsMs: { rebase: 5000, test: 40_000 } } as Event;
}
