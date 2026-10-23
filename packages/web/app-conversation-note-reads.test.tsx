import { afterEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
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

describe("App's note reads", () => {
	let testing: Testing;

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("draws a turn's note reads in the dialog as separate entries with their own times", async () => {
		testing = new Testing();
		const read = (
			id: string,
			at: number,
			subagent: boolean,
			path = "notes/retries.md",
		): Event => ({
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
				events: [
					read("r1", 2.5, false),
					read("r2", 4, true),
					read("r3", 4.5, true, "notes/queue.md"),
				],
			},
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: "Tests" }),
		);
		const counts = await waitFor(() =>
			within(thread).getByRole("button", { name: "quiet events" }),
		);
		// Notes read leave a way in without adding a count.
		expect(counts.textContent).toBe("Details");
		await act(async () => fireEvent.click(counts));
		const dialog = await waitFor(() =>
			within(document.body).getByRole("dialog"),
		);
		const lines = within(dialog).getAllByRole("note", { name: "splates" });
		expect(lines.map((line) => line.textContent)).toEqual([
			"Read notes/retries.md",
			"Read notes/retries.md by a subagent",
			"Read notes/queue.md by a subagent",
		]);
		expect(
			[...dialog.querySelectorAll("time")].map((time) => time.dateTime),
		).toEqual([second(2.5), second(4), second(4.5)]);
	});
});
