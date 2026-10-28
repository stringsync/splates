import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	reopen,
	Testing,
	waitFor,
	wake,
	within,
} from "./testing";

describe("App once the server stays away after a wake", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["openConversations"]>>;

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix login", status: "stopped" }),
		]);
		await waitFor(() => view.getByRole("textbox", { name: "Message input" }));
		testing.goAway();
		await wake();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("says below the bar it cannot reach the server, offers Retry and unlocks the page so it can be read", async () => {
		const input = view.getByRole("textbox", { name: "Message input" });
		const said = await waitFor(() => view.getByText("Offline."));
		expect(said.textContent).toBe("Offline.");
		expect(view.getByRole("button", { name: "Retry" })).toBeDefined();
		expect(input.closest("[inert]")).toBeNull();
		expect(view.queryByRole("status", { name: "Refreshing" })).toBeNull();
	});

	it("shows the conversations again once the server is back", async () => {
		const list = view.getByRole("navigation", { name: "conversations" });
		await waitFor(() => view.getByText("Offline."));
		testing.comeBack();
		await reopen(testing);
		await waitFor(() => within(list).getByText("Fix login"));
		expect(view.queryByText("Offline")).toBeNull();
	});
});
