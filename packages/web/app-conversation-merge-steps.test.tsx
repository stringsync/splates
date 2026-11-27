import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@splates/server/records";
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

	it("draws one live card when an earlier attempt never ended", async () => {
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
					events: [queued(), { ...started(null, second(20)), id: "s2" }],
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
						mergeSince: second(20),
						mergeSteps: {
							steps: [{ step: "rebase", at: second(20) }],
						},
					}),
				],
			},
		);
		const cards = await waitFor(() =>
			view.getAllByRole("region", { name: "Merge" }),
		);
		expect(cards).toHaveLength(1);
	});

	it("says a merge whose turn ended without its end was interrupted", async () => {
		expect(await lines([queued()], 1, false)).toEqual([
			"Merge interruptedalpha",
		]);
	});

	it("places a backgrounded merge card before the Done card", async () => {
		const view = await testing.openConversations([
			{
				...turn(
					[
						tool({
							id: "x1",
							command: "git commit",
							at: second(2),
							until: second(4),
						}),
						tool({
							id: "x2",
							command: "splates merge",
							at: second(10),
							until: second(80),
							background: {
								id: "bg-1",
								state: "completed",
								exitCode: 0,
								until: second(80),
							},
						}),
						{
							type: "text",
							text: "Merging alpha onto main.",
							at: second(15),
						},
						{
							type: "text",
							text: "## ✅ Merged alpha onto main\n\nAll set.",
							at: second(90),
						},
					],
					{ status: "idle" },
				),
				events: [
					started(null, second(20)),
					timed(merged("s1", second(67), null)),
				],
			},
		]);
		const mergeCard = await waitFor(() =>
			view.getByRole("region", { name: "Merge" }),
		);
		const doneCard = await waitFor(() =>
			view.getByRole("region", { name: "merged alpha" }),
		);
		expect(mergeCard.textContent).toContain("Merged in 47s");
		expect(
			Boolean(
				mergeCard.compareDocumentPosition(doneCard) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			),
		).toBe(true);
		expect(view.queryByRole("note", { name: "background command" })).toBeNull();
	});

	it("keeps a live merge card running after the agent's turn ends on a backgrounded merge", async () => {
		const view = await testing.openConversations(
			[
				{
					...turn(
						[
							tool({
								id: "x1",
								command: "splates merge --message 'Land fix'",
								at: second(2),
								background: {
									id: "bg-1",
									state: "running",
									exitCode: null,
									until: null,
								},
							}),
							"Merging in the background.",
						],
						{ status: "idle" },
					),
					task: "alpha",
					name: "Landing",
					background: [
						{
							id: "bg-1",
							name: "splates merge",
							command: "splates merge --message 'Land fix'",
							subagent: null,
							state: "running",
							output: null,
						},
					],
					events: [queued(), started("q1", second(10))],
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
								{ step: "test", at: second(10), output: "/g/1-test.log" },
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
		expect(view.container.textContent).not.toContain("Merge interrupted");
		// Specialized card replaces the generic thread line, while the Background panel keeps it.
		expect(view.queryByRole("note", { name: "background command" })).toBeNull();
		expect(
			view.getByRole("region", { name: "background commands" }).textContent,
		).toContain("splates merge");
	});

	it("folds a backgrounded merge completion from a later turn back into its original card", async () => {
		const first = turn(
			[
				tool({
					id: "x1",
					command: "splates merge --message 'Land fix'",
					at: second(2),
					background: {
						id: "bg-1",
						state: "completed",
						exitCode: 0,
						until: second(67),
					},
				}),
				"Started merging in the background.",
			],
			{ status: "idle" },
		);
		const view = await testing.openConversations([
			{
				...first,
				messages: [
					...first.messages,
					{
						role: "user",
						parts: [{ type: "text", text: "Any update?" }],
						plan: null,
						at: second(50),
						until: second(50),
					},
					{
						role: "agent",
						parts: [{ type: "text", text: "It just landed." }],
						plan: null,
						at: second(55),
						until: second(70),
					},
				],
				events: [
					queued(),
					started("q1", second(20)),
					timed(merged("q1", second(67), null)),
				],
			},
		]);

		const cards = await waitFor(() =>
			view.getAllByRole("region", { name: "Merge" }),
		);
		expect(cards).toHaveLength(1);
		expect(cards[0]?.textContent).toContain("Merged in 1m 2s");
		expect(view.container.textContent).not.toContain("Merge interrupted");
		expect(view.queryAllByRole("note", { name: "splates" })).toHaveLength(0);
	});

	it("keeps a backgrounded splates wait live after the turn ends and folds its completion across turns", async () => {
		const until = new Date(testing.wall.now() + 120_000).toISOString();
		const began: Event = {
			id: "w1",
			at: second(5),
			action: "wait",
			task: "alpha",
			reason: null,
			conversation: "c1",
			until,
			began: null,
		};
		const base = turn(
			[
				tool({
					id: "x1",
					command: "splates wait alpha",
					at: second(2),
					background: {
						id: "bg-w1",
						state: "running",
						exitCode: null,
						until: null,
					},
				}),
				"Waiting in the background.",
			],
			{ status: "idle" },
		);
		const view = await testing.openConversations([
			{
				...base,
				background: [
					{
						id: "bg-w1",
						name: "splates wait alpha",
						command: "splates wait alpha",
						subagent: null,
						state: "running",
						output: null,
					},
				],
				events: [began],
			},
		]);

		const line = await waitFor(() =>
			view.getByRole("note", { name: "splates" }),
		);
		expect(line.textContent).toContain("Waiting onalpha");
		expect(view.queryByRole("note", { name: "background command" })).toBeNull();

		await testing.say({
			...base,
			messages: [
				...base.messages,
				{
					role: "user",
					parts: [{ type: "text", text: "Still waiting?" }],
					plan: null,
					at: second(30),
					until: second(30),
				},
				{
					role: "agent",
					parts: [{ type: "text", text: "Done waiting." }],
					plan: null,
					at: second(35),
					until: second(50),
				},
			],
			background: [
				{
					id: "bg-w1",
					name: "splates wait alpha",
					command: "splates wait alpha",
					subagent: null,
					state: "completed",
					output: null,
				},
			],
			events: [
				began,
				{
					...began,
					id: "w2",
					at: second(45),
					began: "w1",
				},
			],
		});

		await waitFor(() => {
			expect(view.queryByRole("note", { name: "splates" })).toBeNull();
		});
		expect(view.container.textContent).not.toContain("Wait interrupted");
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
