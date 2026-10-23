import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's test suite card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const asking = conversation({
		title: "Imports",
		messages: [
			message(
				"agent",
				[
					"## 🔐 Permission: run the test suite: the move touches every import",
					"",
					"`--changed` picks most of the suite anyway.",
				].join("\n"),
			),
		],
	});

	it("approves one run from the page, offering the terminal's command too", async () => {
		const view = await testing.openConversations([asking]);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "run the test suite" }),
		);
		expect(card.textContent).toContain("the move touches every import");
		expect(card.textContent).toContain("picks most of the suite anyway");
		expect(
			within(card)
				.getByRole("button", {
					name: `copy splates dev approve-suite ${asking.id}`,
				})
				.getAttribute("title"),
		).toBe(`splates dev approve-suite ${asking.id}`);

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /Approve/ })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: `/api/conversations/${asking.id}/suite`,
			method: "POST",
		});
		expect(card.textContent).toContain("Approved for one run");
		// The agent still has its run to do.
		expect(within(card).queryByRole("button", { name: "Archive" })).toBeNull();
	});
});
