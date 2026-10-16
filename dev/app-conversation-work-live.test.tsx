import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import type { ConversationState } from "../conversations";
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
		const details = () =>
			within(thread)
				.getByRole("list", { name: "timeline" })
				.closest("details") as HTMLDetailsElement;
		await waitFor(() => within(thread).getByText(/^Working/));
		expect(details().open).toBe(false);

		await testing.say(
			turn([tool({ id: "x1", command: "bun test" }), "Tests pass."], {
				status: "running",
			}),
		);
		await waitFor(() => expect(thread.textContent).toContain("Tests pass."));
		expect(details().open).toBe(false);
	});

	it("keeps the agent's latest words in the row while it works, until a moment passes with nothing after them", async () => {
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

		const line = () =>
			thread.querySelector('[data-slot="work"] summary')?.textContent;
		const timeline = await waitFor(() =>
			within(thread).getByRole("list", { name: "timeline" }),
		);
		expect(timeline.textContent).toContain("Now the fix.");
		expect(line()).toMatch(/^Working /);
		act(() => {
			testing.wall.advance(Duration.secs(1));
			testing.timer.fireTimeouts();
		});
		await waitFor(() => expect(thread.textContent).toContain("Now the fix."));
		expect(line()).not.toMatch(/^Working/);
	});

	it("folds what the agent said before its latest call into the row while it works", async () => {
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

		const timeline = await waitFor(() =>
			within(thread).getByRole("list", { name: "timeline" }),
		);
		expect(timeline.textContent).toContain("Let me look.");
		expect(within(thread).getAllByText("Let me look.")).toHaveLength(1);
	});

	it("folds the row once the agent speaks, taking in its words as it goes on, and one opened again stays open", async () => {
		const thread = await opened(
			turn([tool({ id: "x1", command: "bun test" }), "Checking."], {
				status: "running",
			}),
		);
		const timelines = () =>
			within(thread).getAllByRole("list", { name: "timeline" });
		const details = () =>
			timelines()[0]?.closest("details") as HTMLDetailsElement;
		await waitFor(() => expect(thread.textContent).toContain("Checking."));
		expect(details().open).toBe(false);
		expect(timelines()[0]?.textContent).not.toContain("Checking.");
		await act(async () => {
			details().open = true;
			details().dispatchEvent(new Event("toggle"));
		});

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
		await waitFor(() => expect(thread.textContent).toContain("bun run demo"));
		expect(timelines()).toHaveLength(1);
		expect(timelines()[0]?.textContent).toContain("Checking.");
		expect(details().open).toBe(true);
		await testing.say(
			turn(
				[
					tool({ id: "x1", command: "bun test" }),
					"Checking.",
					tool({ id: "x2", command: "bun run demo" }),
					"Still checking.",
				],
				{ status: "running" },
			),
		);
		await waitFor(() =>
			expect(thread.textContent).toContain("Still checking."),
		);
		expect(timelines()).toHaveLength(1);
		expect(timelines()[0]?.textContent).not.toContain("Still checking.");
		expect(details().open).toBe(true);
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
