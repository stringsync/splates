import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AGENTS } from "./fixtures";
import {
	agentList,
	cleanup,
	conversation,
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

	it("dims and locks a phone's inbox rows after a wake, then shows what the server lists now", async () => {
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

		expect(view.getByRole("status", { name: "Refreshing" })).toBeDefined();

		const inbox = view.getByRole("region", { name: "inbox" });
		expect(
			within(inbox).getByText("Fix login").closest("[inert]"),
		).not.toBeNull();
		expect(
			within(inbox).queryByRole("status", { name: "Loading inbox" }),
		).toBeNull();
		await reopen(testing);
		await waitFor(() =>
			expect(view.queryByRole("status", { name: "Refreshing" })).toBeNull(),
		);
		await waitFor(() => within(agentList(view)).getByText("Fix signup"));
		expect(
			within(inbox).queryByText("Fix signup")?.closest("[inert]"),
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

		expect(view.getByRole("status", { name: "Refreshing" })).toBeDefined();

		expect(input.closest("[inert]")).not.toBeNull();
		await pressArchive();
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await reopen(testing);
		await waitFor(() =>
			expect(view.queryByRole("status", { name: "Refreshing" })).toBeNull(),
		);
		await waitFor(() => expect(input.closest("[inert]")).toBeNull());
		await pressArchive();
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});
});
