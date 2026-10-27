import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	clickShown,
	conversation,
	fireEvent,
	message,
	newestFirst,
	openRow,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's conversation list", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows no waiting line when the server has no conversations", async () => {
		const view = await testing.open();

		expect(
			view.queryByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
		).toBeNull();
		expect(view.queryByRole("button", { name: "New" })).toBeNull();
	});

	it("puts New atop the sidebar, above its tabs and out of the list", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			null,
		);
		const tabs = view.getByRole("tablist");
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(tabs.firstElementChild?.textContent).toBe("New");
		expect(within(nav).queryByRole("button", { name: "New" })).toBeNull();
	});

	it("lists a persistent agent among the rest by recency, before the feed of every project comes", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Fix login",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "g1",
					title: "Groomer",
					persistent: "groomer",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(
			within(within(nav).getByRole("list", { name: "conversation list" }))
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Fix login", "Groomer"]);
		expect(within(nav).queryByRole("separator")).toBeNull();
	});

	it("lists conversations at work newest first, each by name with its task on hover, and archived ones apart", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					status: "running",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					status: "running",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({ id: "c3", title: "Old", archived: true }),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(
			within(nav)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Look around", "alpha"]);
		expect(within(nav).queryAllByRole("heading")).toEqual([]);
		expect(
			within(nav).getByRole("button", { name: "Claude alpha" }).title,
		).toBe("alpha");
		// Pinned at the sidebar's foot, under the list rather than in it.
		expect(within(nav).queryByRole("button", { name: /Archived/ })).toBeNull();
		expect(
			within(view.getByRole("tablist")).getAllByRole("button").at(-1)
				?.textContent,
		).toMatch(/^Archived/);
		await openArchived(view);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});
		expect(archived.textContent).toContain("Old");
		expect(location.hash).toBe("#conversations/archived");
	});

	// scry-ignore simple-test-setup: the seven agents, more than a folded list once showed, are what it checks
	it("lists every agent, with nothing to unfold or fold", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "Broke", status: "failed" }),
				conversation({ id: "c2", title: "First", status: "running" }),
				conversation({ id: "c3", title: "Rests" }),
				conversation({ id: "c4", title: "Second", status: "running" }),
				conversation({ id: "c5", title: "Third", status: "running" }),
				conversation({ id: "c6", title: "Fourth", status: "running" }),
				conversation({ id: "c7", title: "Fifth", status: "running" }),
			]),
			"c2",
			{ tasks: [] },
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(
			within(nav)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual([
			"Broke",
			"First",
			"Rests",
			"Second",
			"Third",
			"Fourth",
			"Fifth",
		]);
		expect(within(nav).queryByRole("button", { name: /more$/ })).toBeNull();
		expect(within(nav).queryByRole("button", { name: "Show less" })).toBeNull();
	});

	// scry-ignore simple-test-setup: the archived conversations and when each was archived are what it checks
	it("lists archived conversations last first, each with its project and latest message", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "a1",
					title: "Archived first",
					createdAt: "2026-10-11T10:03:00.000Z",
					archived: true,
					archivedAt: hoursAgo(3),
				}),
				conversation({
					id: "a2",
					title: "Archived last",
					createdAt: "2026-10-11T10:01:00.000Z",
					archived: true,
					archivedAt: hoursAgo(1),
					messages: [
						message("agent", "Earlier reply"),
						message("user", "Latest\nreply"),
					],
				}),
				conversation({
					id: "a3",
					title: "Archived between",
					createdAt: "2026-10-11T10:02:00.000Z",
					archived: true,
					archivedAt: hoursAgo(2),
				}),
			],
			null,
		);
		await openArchived(view);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});

		expect(
			within(archived)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual([
			"Archived last1h agowebappwiz· Latest reply",
			"Archived between2h agowebappwiz",
			"Archived first3h agowebappwiz",
		]);
	});

	it("says how long ago each archived conversation was archived", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "a1",
					title: "Lately",
					archived: true,
					archivedAt: hoursAgo(3),
				}),
				conversation({
					id: "a2",
					title: "Too old to say",
					createdAt: "2026-01-01T10:00:00.000Z",
					archived: true,
					archivedAt: null,
				}),
			],
			null,
		);
		await openArchived(view);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});

		expect(
			within(archived)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Lately3h agowebappwiz", "Too old to saywebappwiz"]);
	});

	it("drops an archived conversation once the server deletes it", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "live", title: "Live" }),
				conversation({ id: "a1", title: "Put away", archived: true }),
				conversation({ id: "a2", title: "Older", archived: true }),
			],
			null,
		);
		await openArchived(view);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});

		await testing.remove("a2");

		expect(within(archived).getAllByRole("listitem")).toHaveLength(1);
		expect(archived.textContent).toContain("Put away");
		expect(archived.textContent).not.toContain("Older");
	});

	it("names the branch atop an open conversation's widgets, the trunk's for the main tree", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
			conversation({ id: "c2", title: "Look around" }),
		]);
		const branch = () =>
			within(view.getByRole("navigation", { name: "actions" })).getAllByRole(
				"button",
			)[0]?.textContent;

		expect(branch()).toBe("task/alpha");
		await openRow(view, "Look around");
		expect(branch()).toBe("main");
	});

	it("renames a conversation at work from its menu in the sidebar", async () => {
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

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More for alpha" })),
		);
		await clickShown(() => view.getByRole("menuitem", { name: "Rename" }));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "Rename alpha" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "Login redirect" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(testing.posted("/api/conversations/c1/name")).toEqual([
			{ method: "PUT", body: { name: "Login redirect" } },
		]);
	});

	it("marks a conversation read once opened, and one not open unread from its menu", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Fix login",
					status: "running",
					unread: true,
				}),
				conversation({ id: "c2", title: "Fix footer", status: "running" }),
			],
			"c1",
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/unread")).toEqual([
				{ method: "PUT", body: { unread: false } },
			]),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More for Fix login" })),
		);
		expect(view.queryByRole("menuitem", { name: "Mark as unread" })).toBeNull();
		await act(async () =>
			fireEvent.keyDown(document.activeElement ?? document.body, {
				key: "Escape",
			}),
		);
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "More for Fix footer" }),
			),
		);
		await clickShown(() =>
			view.getByRole("menuitem", { name: "Mark as unread" }),
		);

		expect(testing.posted("/api/conversations/c2/unread")).toEqual([
			{ method: "PUT", body: { unread: true } },
		]);
	});

	it("renames on a double click, in the list and on the open conversation's title", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				task: "alpha",
				title: "Fix login",
				status: "running",
			}),
		]);
		const nav = view.getByRole("navigation", { name: "conversations" });

		await act(async () =>
			fireEvent.doubleClick(
				within(nav).getByRole("button", { name: "Claude alpha" }),
			),
		);
		const inList = await waitFor(() =>
			within(nav).getByRole("textbox", { name: "Rename alpha" }),
		);
		await act(async () => fireEvent.keyDown(inList, { key: "Escape" }));
		expect(
			within(nav).queryByRole("textbox", { name: "Rename alpha" }),
		).toBeNull();

		// The open conversation's title, in the page's bar atop its thread.
		await act(async () =>
			fireEvent.doubleClick(view.getByRole("heading", { name: "alpha" })),
		);
		const box = view.getByRole("textbox", { name: "Rename alpha" });
		await act(async () =>
			fireEvent.change(box, { target: { value: "Login redirect" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(testing.posted("/api/conversations/c1/name")).toEqual([
			{ method: "PUT", body: { name: "Login redirect" } },
		]);
	});

	it("shows the inbox or one conversation on a phone, with a way back", async () => {
		resize(390, 844);
		try {
			const view = await testing.openConversations(
				[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
				null,
			);
			const inbox = view.getByRole("region", { name: "inbox" });
			await act(async () =>
				fireEvent.click(within(inbox).getByRole("button", { name: /alpha/ })),
			);

			expect(view.queryByRole("region", { name: "inbox" })).toBeNull();
			await act(async () =>
				fireEvent.click(
					view.getByRole("button", { name: "Back to conversations" }),
				),
			);
			expect(view.getByRole("region", { name: "inbox" })).toBeTruthy();
			expect(view.queryByRole("region", { name: "alpha" })).toBeNull();
		} finally {
			resize(1024, 768);
		}
	});
});

/** Opens the archived conversations from the sidebar's foot. */
async function openArchived(view: ConversationsView): Promise<void> {
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: /Archived/ })),
	);
}

function hoursAgo(hours: number): string {
	return new Date(Date.now() - hours * 3_600_000).toISOString();
}
