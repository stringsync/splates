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

	it("draws a turn's note reads as one line that lists each note once", async () => {
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
		const line = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "splates" });
			expect(found).toHaveLength(1);
			return found[0] as HTMLElement;
		});
		expect(line.textContent).toBe("Read2 notes");
		await act(async () => fireEvent.click(within(line).getByRole("button")));
		const list = await waitFor(() =>
			view.getByRole("list", { name: "Read this turn" }),
		);
		expect(
			within(list)
				.getAllByRole("button")
				.map((row) => row.textContent),
		).toEqual(["retries.md", "queue.mdby a subagent"]);
	});
});
