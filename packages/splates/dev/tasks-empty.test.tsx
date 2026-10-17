import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing } from "./testing";

describe("Tasks empty state", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("opens a new conversation from the empty tasks page", async () => {
		const view = await testing.openConversations([], null, { tasks: [] });
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Tasks/ })),
		);

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Start a conversation" }),
			),
		);

		expect(view.getByRole("region", { name: "new conversation" })).toBeTruthy();
		expect(location.hash).toBe("#conversations/new");
	});

	it("explains the empty state without offering an unavailable conversation", async () => {
		const view = await testing.openTasks({ tasks: [] });

		expect(view.getByText("No tasks yet")).toBeTruthy();
		expect(
			view.queryByRole("button", { name: "Start a conversation" }),
		).toBeNull();
	});
});
