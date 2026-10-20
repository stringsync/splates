import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's queue card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const asking = conversation({
		title: "Billing",
		messages: [
			message(
				"agent",
				[
					"## 📥 Queue lane 3: Billing export",
					"",
					"Two tasks, the writer first.",
				].join("\n"),
			),
		],
	});

	const board = {
		todos: [
			todo({ id: 31, subject: "Write the CSV", lane: 3, stage: "ready" }),
			todo({ id: 32, subject: "Serve the export", lane: 3, stage: "ready" }),
		],
		lanes: [{ id: 3, name: "Billing export" }],
	};

	it("lists the lane's tasks, and Queue now queues the lane from the page itself", async () => {
		const view = await testing.openConversations([asking], undefined, board);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "queue Billing export" }),
		);
		expect(card.textContent).toContain("Write the CSV");
		expect(card.textContent).toContain("Serve the export");
		expect(card.textContent).toContain("Two tasks, the writer first.");

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /Queue now/ })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes/3",
			method: "PUT",
			body: JSON.stringify({ queued: true }),
		});
	});

	it("leaves the work on the board on Later", async () => {
		const view = await testing.openConversations([asking], undefined, board);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "queue Billing export" }),
		);
		const sent = testing.posts.length;

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /Later/ })),
		);

		expect(card.textContent).toContain("Left on the board");
		expect(testing.posts.length).toBe(sent);
	});
});
