import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
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

	it("says in the bar it cannot reach splates over the dimmed page, and tries again on Retry", async () => {
		const list = view.getByRole("navigation", { name: "conversations" });
		const said = await waitFor(() => view.getByRole("alert"));
		expect(said.textContent).toContain("Can't reach splates");
		testing.comeBack();
		await act(async () =>
			fireEvent.click(within(said).getByRole("button", { name: "Retry" })),
		);
		await reopen(testing);
		await waitFor(() => within(list).getByText("Fix login"));
	});

	it("unlocks the open thread once its saying it cannot reach splates is dismissed", async () => {
		const input = view.getByRole("textbox", { name: "Message input" });
		const said = await waitFor(() => view.getByRole("alert"));
		expect(input.closest("[inert]")).not.toBeNull();
		await act(async () =>
			fireEvent.click(within(said).getByRole("button", { name: "Dismiss" })),
		);
		expect(input.closest("[inert]")).toBeNull();
		within(view.getByRole("alert")).getByRole("button", { name: "Retry" });
	});
});
