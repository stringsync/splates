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
	textIn,
	typeAtCaret,
	typeIn,
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

	it("keeps a phone's inbox usable after a wake, then shows what the server lists now", async () => {
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

		expect(
			view.getByRole("status", { name: "Refreshing" }).closest("header"),
		).not.toBeNull();

		const inbox = view.getByRole("region", { name: "inbox" });
		expect(within(inbox).getByText("Fix login").closest("[inert]")).toBeNull();
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

	it.each([390, 1024])(
		"replaces Update with one refresh indicator at %dpx",
		async (width) => {
			resize(width, 844);
			const view = await testing.openConversations(
				[conversation({ id: "c1", title: "Fix login" })],
				null,
				{ release: { running: "0.0.58", newest: "0.0.59" } },
			);
			await waitFor(() => view.getByRole("button", { name: "Update" }));
			await wake();
			expect(view.queryByRole("button", { name: "Update" })).toBeNull();
			expect(view.getAllByRole("status", { name: "Refreshing" })).toHaveLength(
				1,
			);
			await reopen(testing);
			await waitFor(() => view.getByRole("button", { name: "Update" }));
			expect(view.queryByRole("status", { name: "Refreshing" })).toBeNull();
		},
	);

	it.each([390, 1024])(
		"preserves the composer, draft and caret through a refresh at %dpx",
		async (width) => {
			resize(width, 844);
			const view = await testing.openConversations([
				conversation({ id: "c1", title: "Fix login", status: "stopped" }),
			]);
			const input = await waitFor(() =>
				view.getByRole("textbox", { name: "Message input" }),
			);
			await typeIn(input, "Draft in progress");
			expect(document.activeElement).toBe(input);
			await wake();
			expect(view.getByRole("textbox", { name: "Message input" })).toBe(input);
			expect(document.activeElement).toBe(input);
			expect(textIn(input)).toBe("Draft in progress");
			await reopen(testing);
			await waitFor(() =>
				expect(view.queryByRole("status", { name: "Refreshing" })).toBeNull(),
			);
			expect(view.getByRole("textbox", { name: "Message input" })).toBe(input);
			expect(document.activeElement).toBe(input);
			await typeAtCaret(input, " continues");
			expect(textIn(input)).toBe("Draft in progress continues");
			expect(testing.reloads).toBe(0);
		},
	);

	it.each([390, 1024])(
		"keeps an open thread usable while reconnecting at %dpx",
		async (width) => {
			resize(width, 844);
			const view = await testing.openConversations([
				conversation({ id: "c1", title: "Fix login", status: "stopped" }),
			]);
			const input = await waitFor(() =>
				view.getByRole("textbox", { name: "Message input" }),
			);
			expect(input.closest("[inert]")).toBeNull();

			await wake();

			expect(
				view.getByRole("status", { name: "Refreshing" }).closest("header"),
			).not.toBeNull();

			expect(input.closest("[inert]")).toBeNull();
			await pressArchive();
			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]);
			await reopen(testing);
			await waitFor(() =>
				expect(view.queryByRole("status", { name: "Refreshing" })).toBeNull(),
			);
		},
	);
});
