import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import { workTimeline } from "./drivers";
import {
	cleanup,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's note reads", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("adds no count to the row for note reads, and draws them in its timeline as one line", async () => {
		const view = await testing.openConversations([
			{
				...turn([
					tool({
						id: "r1",
						kind: "read",
						paths: ["/repo/notes/retries.md"],
						at: second(2),
						until: second(3),
					}),
					"Read it.",
				]),
				events: [
					read("r1", 2.5),
					read("r2", 4, { subagent: true }),
					read("r3", 4.5, { subagent: true, path: "notes/queue.md" }),
				],
			},
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);
		await waitFor(() => expect(thread.textContent).toContain("Read it."));
		expect(
			within(thread).queryByRole("note", { name: "quiet events" }),
		).toBeNull();
		const lines = workTimeline(thread).querySelectorAll(
			'[data-slot="quiet-event"]',
		);
		expect([...lines].map((line) => line.textContent)).toEqual(["Read2 notes"]);
	});
});

/** A note read at `at` seconds by the tool call `id`. */
function read(id: string, at: number, opts: ReadOpts = {}): Event {
	const { subagent = false, path = "notes/retries.md" } = opts;
	return {
		id,
		at: second(at),
		action: "note read",
		task: null,
		reason: null,
		conversation: "c1",
		path,
		hash: null,
		tool: id,
		subagent,
	};
}

/** How `read` reads its note. */
interface ReadOpts {
	/** A subagent read it, not the conversation's agent. */
	subagent?: boolean;
	/** The note read, from the project root. */
	path?: string;
}
