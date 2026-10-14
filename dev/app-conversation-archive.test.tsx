import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	pressArchive,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's archiving conversations", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("archives a stopped conversation from the list, with the agent's mark in place of its name", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					status: "stopped",
				}),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(within(nav).getByRole("img", { name: "Claude" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "Archive alpha" }),
			),
		);

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("asks before archiving a conversation whose agent is still running", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					status: "running",
				}),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		const archive = () =>
			act(async () =>
				fireEvent.click(
					within(nav).getByRole("button", { name: "Archive alpha" }),
				),
			);

		await archive();
		const dialog = view.getByRole("dialog", { name: "Archive alpha?" });
		expect(dialog.textContent).toContain("still running");
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);

		await archive();
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "Archive alpha?" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("archives the open conversation on ⌥⌘⌫, going on to the next agent waiting on you", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Broke", status: "failed" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		// Backspace alone, or ⌥⌫ that deletes a word, archives nothing.
		await act(async () =>
			fireEvent.keyDown(document.body, { code: "Backspace", altKey: true }),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await pressArchive();

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/c2"));
		expect(view.getByRole("heading", { name: "Broke" })).toBeTruthy();
	});

	it("goes on to the next agent waiting on you from the actions' Archive, and from the open row's in the list", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Broke", status: "failed" }),
			conversation({ id: "c3", title: "Asks", status: "failed" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /^Archive/ },
				),
			),
		);
		await waitFor(() => expect(location.hash).toBe("#conversations/c2"));

		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: "Archive Broke" }),
			),
		);
		expect(testing.posted("/api/conversations/c2/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/c3"));
	});

	it("stays on the open conversation when the list archives another", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Broke", status: "failed" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: "Archive Broke" }),
			),
		);

		expect(testing.posted("/api/conversations/c2/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("archives the open conversation on ⌥⌘⌫ to a new one with none waiting, asking first while its agent runs", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix login", status: "running" }),
		]);

		await pressArchive();
		const dialog = view.getByRole("dialog", { name: "Archive Fix login?" });
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Archive" })),
		);

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/new"));
	});

	it("archives on ⌥⌘⌫ to a merged conversation with none waiting, as ⌥⌘M would", async () => {
		await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({
				id: "c2",
				title: "Merged",
				status: "stopped",
				messages: [
					message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
				],
			}),
			conversation({
				id: "c3",
				title: "Unread",
				status: "stopped",
				unread: true,
			}),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await pressArchive();
		await waitFor(() => expect(location.hash).toBe("#conversations/c2"));
	});

	it("leaves an archived conversation archived on ⌥⌘⌫", async () => {
		await testing.openConversations([], null);
		await testing.say(conversation({ status: "stopped", archived: true }));
		await act(async () => {
			location.hash = "#conversations/c1";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		await pressArchive();

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("says atop an archived conversation, and in its composer, that sending unarchives it", async () => {
		const view = await testing.openConversations([], null);
		await testing.say(conversation({ status: "stopped", archived: true }));
		await act(async () => {
			location.hash = "#conversations/c1";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		const box = await view.findByRole("textbox", { name: "Message input" });
		expect(box.getAttribute("aria-placeholder")).toBe(
			"Send a message to unarchive and continue",
		);
		expect(
			view.getByText("This conversation is archived.").closest("[role=status]"),
		).not.toBeNull();
	});

	it("takes a message in an archived conversation, and unarchives it from its actions", async () => {
		const view = await testing.openConversations([], null);
		await testing.say(conversation({ status: "stopped", archived: true }));
		await act(async () => {
			location.hash = "#conversations/c1";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		expect(
			view
				.getByRole("textbox", { name: "Message input" })
				.getAttribute("contenteditable"),
		).toBe("true");
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /^Unarchive/ },
				),
			),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: false } },
		]);
	});
});
