import { afterEach, describe, expect, it } from "bun:test";
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

describe("App's note reads", () => {
	let testing: Testing;

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("draws each note read as a line naming the note, a subagent's as its", async () => {
		testing = new Testing();
		const read = (id: string, at: number, subagent: boolean): Event => ({
			id,
			at: second(at),
			action: "note read",
			task: null,
			reason: null,
			conversation: "c1",
			path: "notes/retries.md",
			hash: null,
			tool: id,
			subagent,
		});
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
				events: [read("r1", 2.5, false), read("r2", 4, true)],
			},
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);
		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(2);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Readretries.md",
			"A subagent readretries.md",
		]);
	});
});
