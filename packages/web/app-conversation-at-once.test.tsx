import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	agentList,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	fireEvent,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's list actions on a conversation, shown before the server says so", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
	});

	/** The inbox's agents, by name, in order. */
	function rows(inbox: HTMLElement, names: string[]): (string | undefined)[] {
		return within(inbox)
			.getAllByRole("listitem")
			.map((item) =>
				names.find((name) => within(item).queryByText(name) !== null),
			);
	}

	/** Opens the menu of `name`'s inbox row, as a right-click does. */
	async function menu(view: ConversationsView, name: string) {
		const inbox = agentList(view);
		const row = within(inbox)
			.getAllByText(name)[0]
			?.closest("button") as Element;
		await act(async () => {
			fireEvent.pointerDown(row);
			fireEvent.contextMenu(row);
		});
		return view.getByRole("dialog", { name });
	}

	/** Clicks `action` in the menu of `name`'s inbox row. */
	async function pick(view: ConversationsView, name: string, action: string) {
		const sheet = await menu(view, name);
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: action })),
		);
	}

	it("pins at once, and unpins again when the server refuses", async () => {
		// Its menu is the inbox's, which only a phone has.
		resize(390, 844);
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Old",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					title: "New",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);
		const inbox = agentList(view);
		testing.holdWrites();

		await pick(view, "Old", "Pin");
		expect(rows(inbox, ["Old", "New"])).toEqual(["Old", "New"]);

		testing.refuseWrites = { reason: "usage", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() => expect(rows(inbox, ["Old", "New"])[0]).toBe("New"));
		expect(within(inbox).getByRole("alert").textContent).toBe(
			"Not pinned: locked",
		);
	});

	it("hides an archived row at the click, and brings it back with why when refused", async () => {
		// Its menu is the inbox's, which only a phone has.
		resize(390, 844);
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Done", status: "stopped" }),
				conversation({ id: "c2", title: "Broke", status: "failed" }),
			],
			null,
		);
		const inbox = agentList(view);
		testing.holdWrites();

		await pick(view, "Done", "Archive");
		expect(within(inbox).queryByText("Done")).toBeNull();

		testing.refuseWrites = { reason: "usage", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() =>
			expect(within(inbox).getByRole("alert").textContent).toBe(
				"Not archived: locked",
			),
		);
		expect(within(inbox).getByText("Done")).toBeTruthy();
	});

	it("removes the task before archiving, both behind the row already gone", async () => {
		// Its menu is the inbox's, which only a phone has.
		resize(390, 844);
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", task: "alpha", status: "stopped" }),
				conversation({ id: "c2", title: "Other", status: "stopped" }),
			],
			null,
			{ tasks: [details({ task: "alpha", takenBy: "c1" })] },
		);
		const inbox = agentList(view);
		testing.holdWrites();
		await pick(view, "alpha", "Archive");
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "Archive alpha?" })).getByRole(
					"button",
					{ name: "Archive" },
				),
			),
		);

		// Only its task is left, its conversation gone, until the removal lands.
		expect(
			within(inbox)
				.getAllByText("alpha")
				.map((each) => each.closest("li")?.textContent),
		).toEqual([expect.stringContaining("Its conversation was archived")]);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await act(async () => testing.release());
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]),
		);
	});

	it("marks unread and renames at once", async () => {
		// Its menu is the inbox's, which only a phone has.
		resize(390, 844);
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Open" }),
				conversation({ id: "c2", title: "Fix footer" }),
			],
			null,
		);
		const inbox = agentList(view);
		testing.holdWrites();

		await pick(view, "Fix footer", "Mark as unread");
		expect(
			within(
				within(inbox)
					.getAllByText("Fix footer")[0]
					?.closest("li") as HTMLElement,
			).getByRole("status", { name: "unread" }),
		).toBeTruthy();

		const sheet = await menu(view, "Fix footer");
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: "Rename" })),
		);
		await act(async () =>
			fireEvent.change(
				within(sheet).getByRole("textbox", { name: "Rename Fix footer" }),
				{ target: { value: "  Footer  " } },
			),
		);
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: "Save" })),
		);
		expect(within(inbox).getByText("Footer")).toBeTruthy();
	});

	it("shows the one opened read at once", async () => {
		testing.holdWrites();
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login", unread: true })],
			"c1",
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/unread")).toEqual([
				{ method: "PUT", body: { unread: false } },
			]),
		);
		expect(
			within(
				view.getByRole("navigation", { name: "conversations" }),
			).queryByRole("status", { name: "unread" }),
		).toBeNull();
	});
});
