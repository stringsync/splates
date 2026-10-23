import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing } from "./testing";

describe("Queue page's empty state", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("says the list is empty in one line, offering nothing", async () => {
		const view = await testing.openConversations([], null, { tasks: [] });
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Queue/ })),
		);

		expect(view.getByText("No tasks at work")).toBeTruthy();
		expect(
			view.queryByRole("button", { name: "Start a conversation" }),
		).toBeNull();
	});
});
