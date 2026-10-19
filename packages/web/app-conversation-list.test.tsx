import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	details,
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

	it("shows no Inbox when the server has no conversations", async () => {
		const view = await testing.open();

		expect(view.queryByRole("button", { name: /^Inbox/ })).toBeNull();
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

	it("lists conversations at work newest first, each by name with its task on hover, and archived ones apart in the inbox", async () => {
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
		expect(within(nav).queryByRole("button", { name: /Archived/ })).toBeNull();
		await openArchived(view);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});
		expect(archived.textContent).toContain("Old");
		expect(location.hash).toBe("#conversations/archived");
	});

	it("lists three agents at work under the Inbox, leaving the rest to the inbox, which +N more opens", async () => {
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
		).toEqual(["First", "Second", "Third"]);
		expect(view.queryByRole("region", { name: "inbox" })).toBeNull();
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: "+2 more" })),
		);
		const inbox = view.getByRole("region", { name: "inbox" });
		expect(within(inbox).getByRole("button", { name: /Fifth/ })).toBeTruthy();
		expect(within(inbox).getByRole("button", { name: /Broke/ })).toBeTruthy();
		expect(
			within(nav)
				.getByRole("button", { name: /^Inbox/ })
				.getAttribute("aria-current"),
		).toBe("page");
	});

	// scry-ignore simple-test-setup: the archived conversations and when each was archived are what it checks
	it("lists archived conversations by when each was archived, last first", async () => {
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
			"Archived lastmain1h ago",
			"Archived betweenmain2h ago",
			"Archived firstmain3h ago",
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
		).toEqual(["Latelymain3h ago", "Too old to saymain"]);
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

	it("nests a part's conversations under the task it was handed out from, in the inbox, the sidebar listing the task alone", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					status: "running",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c3",
					agent: "codex",
					task: "alpha-api",
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "alpha-api", base: "task/alpha" }),
				],
			},
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(inboxTrees(view)).toEqual([["alpha", "alpha-api"], ["Look around"]]);
		expect(
			within(nav)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["alpha"]);
	});

	it("keeps a part's conversation under its caller's once both merged", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					lastTask: "alpha",
					lastBase: "main",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					agent: "codex",
					task: null,
					lastTask: "alpha-api",
					lastBase: "task/alpha",
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);

		expect(inboxTrees(view)).toEqual([["alpha", "alpha-api"]]);
	});

	it("nests the tasks a conversation's agent added for its subagents under it, though they land on trunk", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "split-b",
					lastCaller: "c1",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
			],
			null,
			{
				tasks: [
					details({ task: "split-a", caller: "c1" }),
					details({ task: "split-b", caller: "c1" }),
					details({ task: "split-c", caller: "c1" }),
					details({ task: "loose" }),
				],
			},
		);

		expect(inboxTrees(view)).toEqual([
			["split-b", "split-a", "split-c"],
			["loose"],
			["Look around"],
		]);
	});

	it("keeps a subagent's conversation under its caller's once its task merged", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					title: "Orchestrate",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					agent: "codex",
					task: null,
					lastTask: "split-a",
					lastBase: "main",
					lastCaller: "c1",
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);

		expect(inboxTrees(view)).toEqual([["Orchestrate", "split-a"]]);
	});

	// scry-ignore simple-test-setup: the unnamed conversations it lists are what it checks, and no other test opens with them
	it("stands in for a missing name, muted, with what the person first said, else Not started", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					messages: [
						message("user", "\n fix the login\nit loops"),
						message("agent", "On it"),
					],
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c3",
					task: null,
					title: "Fix login",
					messages: [message("user", "fix the login")],
					createdAt: "2026-10-11T10:00:00.000Z",
				}),
			],
			null,
		);
		const names = within(view.getByRole("region", { name: "inbox" }))
			.getAllByRole("listitem")
			.map(nameIn);

		// The external agent at work leads the conversations at rest.
		expect(names.map((name) => name.textContent)).toEqual([
			"alpha",
			"Not started",
			"fix the login",
			"Fix login",
		]);
		expect(names.map((name) => name.classList.contains("italic"))).toEqual([
			false,
			true,
			true,
			false,
		]);
	});

	// scry-ignore simple-test-setup: the orchestrator and its lanes are what it checks, and no other test opens with them
	it("names a lane's orchestrator after its lanes, and the groomer so, marked as a lane, over a task it took and the agent's title", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					title: "Splates Lane 22",
					messages: [message("user", "[SPLATES LANE 22]")],
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
				conversation({
					id: "c2",
					task: "add-line",
					lastTask: "add-line",
					messages: [message("user", "[SPLATES LANE 20]\n[SPLATES LANE 9]")],
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c3",
					task: null,
					messages: [message("user", "[SPLATES LANE untriaged]")],
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c4",
					task: null,
					title: "Splates Groom 7",
					messages: [message("user", "[SPLATES GROOM #7]")],
					createdAt: "2026-10-11T10:00:30.000Z",
				}),
			],
			null,
			{
				laneNames: [
					{ id: 22, name: "Cloudflare Access" },
					{ id: 20, name: "Stats" },
				],
			},
		);
		const items = within(
			view.getByRole("region", { name: "inbox" }),
		).getAllByRole("listitem");
		const names = items.map(nameIn);

		expect(names.map((name) => name.textContent)).toEqual([
			"alpha",
			"Cloudflare Access",
			"Stats, Lane 9",
			"Untriaged",
			"Groomer",
		]);
		expect(
			items.map((item) => within(item).queryByLabelText("Lane") !== null),
		).toEqual([false, true, true, true, true]);
		expect(names.some((name) => name.classList.contains("italic"))).toBe(false);
	});

	it("names the branch under an open conversation's title, the trunk's for the main tree", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
			conversation({ id: "c2", title: "Look around" }),
		]);
		const branch = () =>
			view.getByRole("img", { name: "branch" }).parentElement?.textContent;

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
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Rename" })),
			),
		);
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
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitem", { name: "Mark as unread" }),
				),
			),
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

/** Opens the archived conversations from the inbox's foot, opening it first. */
async function openArchived(view: ConversationsView): Promise<void> {
	if (view.queryByRole("region", { name: "inbox" }) === null) {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Inbox/ })),
		);
	}
	await act(async () =>
		fireEvent.click(
			within(view.getByRole("region", { name: "inbox" })).getByRole("button", {
				name: /Archived/,
			}),
		),
	);
}

/** The inbox's agents, each with those it handed out after it, by name. */
function inboxTrees(view: ConversationsView): (string | null)[][] {
	return within(view.getByRole("region", { name: "inbox" }))
		.getAllByRole("list")
		.map((list) =>
			within(list)
				.getAllByRole("listitem")
				.map((item) => nameIn(item).textContent),
		);
}

/** A row's name, first of what it truncates. */
function nameIn(item: HTMLElement): HTMLElement {
	return item.querySelector("span.truncate") as HTMLElement;
}

function hoursAgo(hours: number): string {
	return new Date(Date.now() - hours * 3_600_000).toISOString();
}
