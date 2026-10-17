import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Compaction, ConversationState } from "../conversations";
import {
	act,
	cleanup,
	fireEvent,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's compactions", () => {
	let testing: Testing;
	/** A turn compacted between a read and the test run that followed. */
	let state: ConversationState;

	beforeEach(() => {
		testing = new Testing();
		const compaction: Compaction = {
			type: "compaction",
			id: "c1",
			status: "completed",
			trigger: "automatic",
			before: 317_025,
			after: 8_589,
			at: second(10),
			until: second(84),
		};
		state = turn([
			tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
			compaction,
			tool({
				id: "x1",
				command: "bun test",
				at: second(90),
				until: second(100),
			}),
			"Done.",
		]);
		state.usage = {
			...state.usage,
			context: { used: 12_000, size: 400_000 },
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("draws a compaction as a line of its own, the work before it apart from the work after", async () => {
		const view = await testing.openConversations([state]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: state.title ?? "" }),
		);

		const line = within(thread).getByRole("note", {
			name: "context compacted",
		});
		expect(line.textContent).toBe("Compacted context317k → 8.6k");
		expect(
			[
				...thread.querySelectorAll(
					'[data-slot="work"], [data-slot="compaction"]',
				),
			].map((each) => each.getAttribute("data-slot")),
		).toEqual(["work", "compaction", "work"]);
	});

	it("says in the context meter's card how the conversation was compacted", async () => {
		const view = await testing.openConversations([state]);
		const meter = await waitFor(() =>
			view.getByRole("button", { name: "3% of context used" }),
		);
		// The ring, its fill, and the dot that says it was compacted.
		expect(meter.querySelectorAll("circle")).toHaveLength(3);

		await act(async () => fireEvent.click(meter));
		const section = await waitFor(() =>
			view.getByRole("region", { name: "Compacted" }),
		);
		expect(section.textContent).toContain("317k → 8.6k");
		expect(section.textContent).toContain("ago");
	});
});
