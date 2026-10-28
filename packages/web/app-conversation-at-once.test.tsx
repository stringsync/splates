import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	agentList,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	resize,
	second,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's list actions on a conversation, pending until the server says so", () => {
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

	/** Whether a write is pending on the row of `name`: busy, though it still shows the server's word. */
	function busy(inbox: HTMLElement, name: string): boolean {
		return (
			within(inbox)
				.getAllByText(name)[0]
				?.closest("[aria-busy]")
				?.getAttribute("aria-busy") === "true"
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

	it("holds a pin pending, and clears it saying why when the server refuses", async () => {
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
		expect(rows(inbox, ["Old", "New"])).toEqual(["New", "Old"]);
		expect(busy(inbox, "Old")).toBe(true);

		testing.refuseWrites = { reason: "usage", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() => expect(busy(inbox, "Old")).toBe(false));
		expect(rows(inbox, ["Old", "New"])).toEqual(["New", "Old"]);
		expect(within(inbox).getByRole("alert").textContent).toBe(
			"Not pinned: locked",
		);
	});

	it("keeps an archiving row, pending, and says why when refused", async () => {
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
		expect(within(inbox).getByText("Done")).toBeTruthy();
		expect(busy(inbox, "Done")).toBe(true);

		testing.refuseWrites = { reason: "usage", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() =>
			expect(within(inbox).getByRole("alert").textContent).toBe(
				"Not archived: locked",
			),
		);
		expect(within(inbox).getByText("Done")).toBeTruthy();
		expect(busy(inbox, "Done")).toBe(false);
	});

	it("removes the task before archiving, the row pending meanwhile", async () => {
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

		// The row waits on the server rather than going early.
		expect(busy(inbox, "alpha")).toBe(true);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([]);
		await act(async () => testing.release());
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/archived")).toEqual([
				{ method: "PUT", body: { archived: true } },
			]),
		);
	});

	it("says a quiet agent may be stuck, and holds it pending while its turn stops", async () => {
		resize(390, 844);
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Quiet",
					status: "running",
					messages: [
						{
							...message("agent", "Looking."),
							at: second(0),
							until: second(1),
						},
					],
				}),
			],
			null,
		);
		const inbox = agentList(view);
		const row = () =>
			within(inbox).getAllByText("Quiet")[0]?.closest("li") as HTMLElement;
		expect(within(row()).getByText(/^Possibly stuck · quiet /)).toBeTruthy();
		testing.holdWrites();

		await pick(view, "Quiet", "Stop turn");
		expect(testing.posted("/api/conversations/c1/cancel")).toHaveLength(1);
		expect(within(row()).getByText(/^Possibly stuck/)).toBeTruthy();
		expect(busy(inbox, "Quiet")).toBe(true);
		await act(async () => testing.release());
	});

	it("holds marking unread and renaming pending until the server says so", async () => {
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
		const unread = () =>
			within(
				within(inbox)
					.getAllByText("Fix footer")[0]
					?.closest("li") as HTMLElement,
			).queryByRole("status", { name: "unread" });
		expect(unread()).toBeNull();
		expect(busy(inbox, "Fix footer")).toBe(true);

		await testing.say(
			conversation({ id: "c2", title: "Fix footer", unread: true }),
		);
		expect(unread()).toBeTruthy();
		// Its write is still unanswered, so it stays pending.
		expect(busy(inbox, "Fix footer")).toBe(true);
		await act(async () => testing.release());
		expect(busy(inbox, "Fix footer")).toBe(false);

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
		expect(within(inbox).queryByText("Footer")).toBeNull();
		await testing.say(
			conversation({
				id: "c2",
				title: "Fix footer",
				unread: true,
				name: "Footer",
			}),
		);
		expect(within(inbox).getByText("Footer")).toBeTruthy();
	});

	it("keeps the one opened unread, pending, until the server says it is read", async () => {
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
		const nav = within(view.getByRole("navigation", { name: "conversations" }));
		expect(nav.queryByRole("status", { name: "unread" })).toBeTruthy();
		await testing.say(conversation({ id: "c1", title: "Fix login" }));
		expect(nav.queryByRole("status", { name: "unread" })).toBeNull();
	});
});
