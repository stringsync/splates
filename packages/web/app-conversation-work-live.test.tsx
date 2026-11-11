import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@splates/server/conversations";
import { Duration } from "core/time";
import { workTimelines } from "./drivers";
import {
	act,
	cleanup,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's work row while working", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const opened = async (state: ConversationState) => {
		const view = await testing.openConversations([state]);
		return await waitFor(() =>
			view.getByRole("region", { name: state.title ?? "" }),
		);
	};
	// What the work row's line says.
	const line = (thread: HTMLElement) =>
		thread.querySelector('[data-slot="work"] summary')?.textContent;
	// Each row's own line, not the calls' summaries inside it once opened.
	const lines = (thread: HTMLElement) =>
		[...thread.querySelectorAll('[data-slot="work"]')].map(
			(each) => each.querySelector("summary")?.textContent,
		);
	// The work row's foldable timeline, the first when there are more.
	const details = (thread: HTMLElement) =>
		workTimelines(thread)[0]?.closest("details") as HTMLDetailsElement;
	it("says only Working and how long it has worked while it works, shimmering, with its plan", async () => {
		const thread = await opened(
			turn(
				[
					tool({
						id: "x1",
						command: "bun test",
						status: "in_progress",
						at: second(20),
					}),
				],
				{
					status: "running",
					plan: [
						{ text: "Run the tests", status: "in_progress" },
						{ text: "Fix what fails", status: "pending" },
					],
				},
			),
		);

		const line = await waitFor(() =>
			within(thread).getByText(/^Working \d+(h|m|s)/),
		);
		expect(line.textContent).not.toContain("bun test");
		expect(line.className).toContain("shimmer");
		expect(within(thread).getByRole("list", { name: "plan" }).textContent).toBe(
			"Run the testsFix what fails",
		);
	});

	it("hides the plan once its row is no longer working", async () => {
		const plan = [{ text: "Run the tests", status: "in_progress" }] as const;
		const thread = await opened(
			turn([tool({ id: "x1", command: "bun test" })], {
				status: "running",
				plan: [...plan],
			}),
		);
		await waitFor(() => within(thread).getByRole("list", { name: "plan" }));

		await testing.say(
			turn([tool({ id: "x1", command: "bun test" }), "Tests are running."], {
				status: "running",
				plan: [...plan],
			}),
		);

		await waitFor(() =>
			expect(thread.textContent).toContain("Tests are running."),
		);
		expect(line(thread)).toMatch(/^Worked/);
		expect(within(thread).queryByRole("list", { name: "plan" })).toBeNull();
	});

	it("stops saying Working once the turn was stopped, before the server says it ended", async () => {
		const stopped = turn(
			[tool({ id: "x1", command: "bun test", status: "in_progress" })],
			{ status: "running", stopped: second(30) },
		);
		const thread = await opened(stopped);

		await waitFor(() =>
			expect(thread.querySelector('[data-slot="stopped"]')).not.toBeNull(),
		);
		expect(line(thread)).toMatch(/^Worked/);
	});

	it("says Working once while it works, on its line rather than under it too", async () => {
		const thread = await opened(
			turn([tool({ id: "x1", command: "bun test", status: "in_progress" })], {
				status: "running",
			}),
		);

		await waitFor(() => within(thread).getByText(/^Working /));
		expect(thread.textContent?.match(/Working/g)).toHaveLength(1);
	});

	it("stays folded while the agent works, and once it replies", async () => {
		const working = turn([tool({ id: "x1", command: "bun test" })], {
			status: "running",
		});
		const thread = await opened(working);
		await waitFor(() => within(thread).getByText(/^Working/));
		expect(details(thread).open).toBe(false);

		await testing.say(
			turn([tool({ id: "x1", command: "bun test" }), "Tests pass."], {
				status: "running",
			}),
		);
		await waitFor(() => expect(thread.textContent).toContain("Tests pass."));
		expect(details(thread).open).toBe(false);
	});

	it("shows the agent's latest words at once, a Working row under them until a moment passes with nothing after them", async () => {
		const thread = await opened(
			turn(
				[
					tool({ id: "x1", command: "bun test" }),
					{
						type: "text",
						text: "Now the fix.",
						at: new Date(testing.wall.now() - 500).toISOString(),
					},
				],
				{ status: "running" },
			),
		);

		await waitFor(() =>
			expect(lines(thread)).toEqual([
				expect.stringMatching(/^Worked/),
				"Working",
			]),
		);
		expect(thread.textContent).toMatch(/Worked.*Now the fix\..*Working/);
		expect(thread.querySelector('[data-slot="work"] .shimmer')).not.toBeNull();
		act(() => {
			testing.wall.advance(Duration.secs(1));
			testing.timer.fireTimeouts();
		});
		// Now the reply, it ends the turn's rows.
		await waitFor(() => expect(lines(thread)).toHaveLength(1));
		expect(thread.textContent).toContain("Now the fix.");
	});

	it("says Worked above its reply, and Working only under it, while the turn goes on after the reply", async () => {
		const thread = await opened(
			turn(
				[
					tool({ id: "a1", kind: "think", status: "completed" }),
					tool({
						id: "a2",
						command: "bun test",
						status: "in_progress",
						parent: "a1",
					}),
					"Four agents are at work.",
				],
				{ status: "running" },
			),
		);

		await waitFor(() =>
			expect(thread.textContent).toContain("Four agents are at work."),
		);
		expect(line(thread)).toMatch(/^Worked/);
		const text = thread.textContent ?? "";
		expect(text.match(/Work(ed|ing)/g)).toEqual(["Worked", "Working"]);
		expect(text.indexOf("Working")).toBeGreaterThan(
			text.indexOf("Four agents are at work."),
		);
	});

	it("shows what the agent said before its latest call above the working row", async () => {
		const thread = await opened(
			turn(
				[
					"Let me look.",
					tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
					{ type: "thought", text: "Which tests?", at: second(1) },
				],
				{ status: "running" },
			),
		);

		await waitFor(() => expect(line(thread)).toMatch(/^Working/));
		expect(thread.textContent).toMatch(/Let me look\..*Working/);
		expect(workTimelines(thread)[0]?.textContent).not.toContain("Let me look.");
		expect(within(thread).getAllByText("Let me look.")).toHaveLength(1);
		expect(thread.textContent).not.toContain("Which tests?");
	});

	it("keeps a provisional reply in the thread, between its row and a new one, when another call follows", async () => {
		const thread = await opened(
			turn([tool({ id: "x1", command: "bun test" }), "Checking."], {
				status: "running",
			}),
		);
		await waitFor(() => expect(thread.textContent).toContain("Checking."));
		expect(details(thread).open).toBe(false);
		expect(workTimelines(thread)[0]?.textContent).not.toContain("Checking.");

		await testing.say(
			turn(
				[
					tool({ id: "x1", command: "bun test" }),
					"Checking.",
					tool({ id: "x2", command: "bun run demo" }),
				],
				{ status: "running" },
			),
		);
		await waitFor(() =>
			expect(lines(thread)).toEqual([
				expect.stringMatching(/^Worked/),
				expect.stringMatching(/^Working/),
			]),
		);
		expect(within(thread).getAllByText("Checking.")).toHaveLength(1);
		const [ran, demo] = workTimelines(thread);
		expect(ran?.textContent).toContain("bun test");
		expect(demo?.textContent).toContain("bun run demo");
		expect(thread.textContent).toMatch(/Worked.*Checking\..*Working/);
	});
	it("shows what the agent already wrote at once on opening it mid-turn, typing out only what comes after", async () => {
		const words = "The tests ran, and two of them failed on the parser.";
		const thread = await opened(turn([words], { status: "running" }));

		// Typed out, it would show none of it yet.
		expect(thread.textContent).toContain(words);

		const more = " Fixing the first now, since the second follows from it.";
		await testing.say(turn([words + more], { status: "running" }));
		expect(thread.textContent).toContain(words);
		expect(thread.textContent).not.toContain(more.trim());
		await waitFor(() => expect(thread.textContent).toContain(more.trim()));
	});
});
