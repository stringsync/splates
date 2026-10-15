import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
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

describe("App's arbor events", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The thread of a turn, opened with `events`. */
	const opened = async (state: ConversationState, events: Event[]) => {
		const view = await testing.openConversations([{ ...state, events }]);
		return await waitFor(() => view.getByRole("region", { name: "Tests" }));
	};

	it("draws each event as a line between the work it came in, a refused one marked", async () => {
		const state = turn([
			tool({
				id: "x1",
				command: "arbor claim alpha",
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
			"It stops now.",
		]);
		const thread = await opened(state, [
			claim("alpha", 3.5),
			claim("beta", 10.5, "lease_held"),
		]);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Claimedalpha",
			"Claim failedbeta",
		]);
		expect(
			within(thread).getAllByRole("list", { name: "timeline" }),
		).toHaveLength(2);
		expect(thread.textContent).toMatch(
			/arbor claim alpha.*Claimedalpha.*a\.ts.*Claim failedbeta.*It stops now\./,
		);
	});

	it("draws nothing for an action no line is drawn for yet", async () => {
		const thread = await opened(turn(["Done."]), [
			{
				id: "r",
				at: second(2),
				action: "retry",
				task: "alpha",
				reason: null,
				conversation: "c1",
			},
		]);

		await waitFor(() => expect(thread.textContent).toContain("Done."));
		expect(within(thread).queryAllByRole("note", { name: "arbor" })).toEqual(
			[],
		);
	});

	it("folds todo updates in a row into one line listing each", async () => {
		const thread = await opened(
			turn([
				tool({
					id: "x1",
					command: "arbor todo update 1",
					at: second(2),
					until: second(3),
				}),
				"Groomed.",
			]),
			[update(1, 3.1, "One"), update(2, 3.2, "Two"), update(3, 3.3, "Three")],
		);

		const line = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(1);
			return found[0] as HTMLElement;
		});
		expect(line.textContent).toContain("Updated3 todos");
		expect(line.textContent).toContain("#1 One");
		expect(line.textContent).toContain("#3 Three");
	});

	it("draws one todo update with what changed in its chip's title", async () => {
		const thread = await opened(turn(["Done."]), [update(7, 2, "Seven")]);

		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "arbor" }),
		);
		expect(line.textContent).toBe("Updated#7 Seven");
		expect(line.querySelector("[title]")?.getAttribute("title")).toContain(
			"moved to position 2",
		);
	});
});

/** A todo update the agent ran at `secs`, moving todo `id` to position 2. */
function update(id: number, secs: number, subject: string): Event {
	return {
		id: `u${id}`,
		at: second(secs),
		action: "todo update",
		task: null,
		reason: null,
		conversation: "c1",
		todo: id,
		subject,
		changed: { position: 2 },
	};
}

/** A claim of `task` the agent ran at `secs`, refused as `reason` when given. */
function claim(task: string, secs: number, reason?: string): Event {
	return reason === undefined
		? {
				id: task,
				at: second(secs),
				action: "claim",
				task,
				reason: null,
				conversation: "c1",
				escalated: false,
			}
		: {
				id: task,
				at: second(secs),
				action: "claim",
				task,
				reason,
				conversation: "c1",
			};
}
