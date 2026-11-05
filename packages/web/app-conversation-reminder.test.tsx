import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	details,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

const PLAN =
	"# alpha\n\n## Before\n\nTabs split it.\n\n## After\n\nOne page. Sections fold.\n";

describe("App's reminder of a conversation's task", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("says it shows a task's conversation, with the card its record makes", async () => {
		await testing.openConversations(
			[conversation({ id: "c1", task: "alpha" })],
			"c1",
			{ tasks: [details({ task: "alpha", takenBy: "c1", plan: PLAN })] },
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/visit")[0]).toEqual({
				method: "PUT",
				body: {
					card: {
						task: "alpha",
						line: "One page.",
						before: "Tabs split it.",
						after: "Sections fold.",
					},
				},
			}),
		);
	});

	it("says nothing of a conversation with no task", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Plain" }),
		]);

		await waitFor(() =>
			expect(view.getByRole("region", { name: "Plain" })).toBeTruthy(),
		);
		expect(testing.posted("/api/conversations/c1/visit")).toEqual([]);
	});

	it("shows each reminder in the thread, after the turn it came in", async () => {
		const at = new Date().toISOString();
		const view = await testing.openConversations([
			conversation({
				title: "Alpha",
				messages: [
					message("user", "go"),
					{ ...message("agent", "Started."), at: "2020-01-01T00:00:00.000Z" },
				],
				reminders: [
					{
						task: "alpha",
						line: "One page.",
						before: "Tabs split it.",
						after: "Sections fold.",
						at,
						since: new Date(Date.parse(at) - 2 * 3_600_000).toISOString(),
					},
				],
			}),
		]);

		const card = await view.findByRole("region", {
			name: "reminder of alpha",
		});
		const shown = within(card);
		expect(card.textContent).toContain("last here 2h ago");
		expect(shown.getByText("One page.")).toBeTruthy();
		expect(shown.getByRole("region", { name: "Before" }).textContent).toContain(
			"Tabs split it.",
		);
		expect(shown.getByRole("region", { name: "After" }).textContent).toContain(
			"Sections fold.",
		);
		expect(
			shown.getAllByRole("button").map((each) => each.textContent),
		).toEqual(["Open task"]);
	});
});
