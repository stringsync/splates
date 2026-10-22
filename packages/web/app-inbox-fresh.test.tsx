import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AGENTS } from "./fixtures";
import {
	act,
	agentList,
	cleanup,
	conversation,
	fireEvent,
	pressArchive,
	reopen,
	resize,
	Testing,
	waitFor,
	wake,
	within,
} from "./testing";

describe("App's inbox while what it shows may be stale", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
	});

	it("shows a phone's inbox loading after a wake, then what the server lists now", async () => {
		resize(390, 844);
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			null,
		);
		await waitFor(() => within(agentList(view)).getByText("Fix login"));
		testing.talk = {
			agents: AGENTS,
			conversations: [conversation({ id: "c1", title: "Fix signup" })],
		};

		await wake();

		const inbox = view.getByRole("region", { name: "inbox" });
		within(inbox).getByRole("status", { name: "Loading inbox" });
		expect(within(inbox).queryByText("Fix login")).toBeNull();
		await reopen(testing);
		await waitFor(() => within(agentList(view)).getByText("Fix signup"));
		expect(
			within(inbox).queryByRole("status", { name: "Loading inbox" }),
		).toBeNull();
	});

	it("takes no input in the open thread until the server answers after a wake", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix login", status: "stopped" }),
		]);
		const input = await waitFor(() =>
			view.getByRole("textbox", { name: "Message input" }),
		);
		expect(input.closest("[inert]")).toBeNull();

		await wake();

		expect(input.closest("[inert]")).not.toBeNull();
		view.getByText("Catching up…");
		await pressArchive();
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await reopen(testing);
		await waitFor(() => expect(input.closest("[inert]")).toBeNull());
		await pressArchive();
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("says it cannot reach splates once the server stays away, and tries again on Retry", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			null,
		);
		testing.goAway();

		await wake();

		const list = view.getByRole("navigation", { name: "conversations" });
		const said = await waitFor(() => within(list).getByRole("alert"));
		expect(said.textContent).toContain("Can't reach splates.");
		testing.comeBack();
		await act(async () =>
			fireEvent.click(within(said).getByRole("button", { name: "Retry" })),
		);
		await reopen(testing);
		await waitFor(() => within(list).getByText("Fix login"));
	});
});
