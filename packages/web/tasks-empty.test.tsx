import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, Testing } from "./testing";

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
		await act(async () => {
			location.hash = "#tasks";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		expect(await view.findByText("Nothing running")).toBeTruthy();
		expect(
			view.queryByRole("button", { name: "Start a conversation" }),
		).toBeNull();
	});
});
