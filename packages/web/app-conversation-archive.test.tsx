import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	openRow,
	pressArchive,
	resize,
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

	/**
	 * Archives the sidebar's row named `name`, at work, so past the question
	 * whether to stop its agent.
	 */
	const archiveInSidebar = async (view: ConversationsView, name: string) => {
		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("navigation", { name: "conversations" }),
				).getByRole("button", { name: `Archive ${name}` }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("dialog", { name: `Archive ${name}?` }),
				).getByRole("button", { name: "Archive" }),
			),
		);
	};

	/** Archives the inbox's row named `name` from the menu a right-click opens. */
	const archiveInInbox = async (view: ConversationsView, name: string) => {
		const inbox = view.getByRole("region", { name: "inbox" });
		const row = within(inbox).getByRole("button", { name: RegExp(name) });
		// As a mouse's right button does: the button down, then the menu.
		await act(async () => {
			fireEvent.pointerDown(row);
			fireEvent.contextMenu(row);
		});
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name })).getByRole("button", {
					name: "Archive",
				}),
			),
		);
	};

	it("archives a stopped conversation from the inbox, with the agent's mark in place of its name", async () => {
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
		const inbox = view.getByRole("region", { name: "inbox" });

		expect(within(inbox).getByRole("img", { name: "Claude" })).toBeTruthy();
		await archiveInInbox(view, "alpha");

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

	it("asks before archiving the conversation that last took its task, and removes the task before archiving it", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", status: "stopped" })],
			null,
			{ tasks: [details({ task: "alpha", takenBy: "c1", ahead: 2 })] },
		);
		const archive = () => archiveInInbox(view, "alpha");

		await archive();
		const dialog = view.getByRole("dialog", { name: "Archive alpha?" });
		expect(dialog.textContent).toContain(
			"Archiving removes its task, alpha: its 2 commits not on main",
		);
		expect(dialog.textContent).not.toContain("terminal");
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
		);
		expect(testing.posts).toEqual([]);

		await archive();
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "Archive alpha?" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);
		await waitFor(() =>
			expect(testing.posts.map(({ method, path }) => [method, path])).toEqual([
				["DELETE", "/api/tasks/alpha"],
				["PUT", "/api/conversations/c1/archived"],
			]),
		);
	});

	it("keeps the conversation unarchived when its task is not removed", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", status: "stopped" })],
			null,
			{ tasks: [details({ task: "alpha", takenBy: "c1" })] },
		);
		testing.refuseWrites = { reason: "usage", message: "locked" };

		await archiveInInbox(view, "alpha");
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "Archive alpha?" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);

		expect(
			await within(view.getByRole("region", { name: "inbox" })).findByText(
				/Not removed/,
			),
		).toBeTruthy();
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
	});

	it("leaves a task another conversation took since, archiving without asking", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", status: "stopped" })],
			null,
			{ tasks: [details({ task: "alpha", takenBy: "c2" })] },
		);

		await archiveInInbox(view, "alpha");

		expect(view.queryByRole("dialog")).toBeNull();
		expect(testing.posted("/api/tasks/alpha")).toEqual([]);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("archives a lane's orchestrator without asking once every agent it started is done", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "o1", title: "Stats lane", status: "stopped" }),
				conversation({
					id: "c1",
					startedBy: "o1",
					lastTask: "alpha",
					status: "stopped",
				}),
			],
			null,
		);

		await archiveInInbox(view, "Stats lane");

		expect(view.queryByRole("dialog")).toBeNull();
		expect(testing.posted("/api/conversations/o1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("asks before archiving a lane's orchestrator while an agent it started holds its task", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "o1", title: "Stats lane", status: "stopped" }),
				conversation({
					id: "c1",
					startedBy: "o1",
					task: "alpha",
					status: "idle",
				}),
			],
			null,
			{ tasks: [details({ task: "alpha", takenBy: "c1" })] },
		);

		await archiveInInbox(view, "Stats lane");
		const dialog = view.getByRole("dialog", { name: "Archive Stats lane?" });
		expect(dialog.textContent).toContain("or started with it");
		expect(dialog.textContent).toContain("alpha");
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Archive" })),
		);

		expect(testing.posted("/api/conversations/o1/archived")).toEqual([
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

	it("goes on to the next agent waiting on you from the actions' Archive, and from the open row's in the sidebar", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Broke", status: "failed" }),
			// At work, so the sidebar lists it.
			conversation({ id: "c4", title: "Busy", status: "running" }),
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

		await openRow(view, "Busy");
		await archiveInSidebar(view, "Busy");
		expect(testing.posted("/api/conversations/c4/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		await waitFor(() => expect(location.hash).toBe("#conversations/c3"));
	});

	it("goes back to the inbox on a phone, rather than on to the next agent waiting on you", async () => {
		resize(390, 844);
		try {
			const view = await testing.openConversations([
				conversation({ id: "c1", title: "Done", status: "stopped" }),
				conversation({ id: "c2", title: "Broke", status: "failed" }),
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
			await waitFor(() =>
				expect(view.getByRole("region", { name: "inbox" })).toBeTruthy(),
			);
			expect(location.hash).toBe("#conversations");
		} finally {
			resize(1024, 768);
		}
	});

	it("stays on the open conversation when the sidebar archives another", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Done", status: "stopped" }),
			conversation({ id: "c2", title: "Busy", status: "running" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await archiveInSidebar(view, "Busy");

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
