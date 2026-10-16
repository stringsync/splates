import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
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

	it("shows no Conversations when the server has none", async () => {
		const view = await testing.open();

		expect(view.queryByRole("tab", { name: /Conversations/ })).toBeNull();
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

	it("lists conversations newest first, each by name with its task on hover, and archived ones apart", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					title: "Fix login",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
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
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Archived/ })),
		);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});
		expect(archived.textContent).toContain("Old");
		expect(location.hash).toBe("#conversations/archived");
	});

	it("lists archived conversations by when each was archived, last first", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "a1",
					title: "Archived first",
					createdAt: "2026-10-11T10:03:00.000Z",
					archived: true,
					archivedAt: "2026-10-12T10:00:00.000Z",
				}),
				conversation({
					id: "a2",
					title: "Archived last",
					createdAt: "2026-10-11T10:01:00.000Z",
					archived: true,
					archivedAt: "2026-10-12T12:00:00.000Z",
				}),
				conversation({
					id: "a3",
					title: "Archived between",
					createdAt: "2026-10-11T10:02:00.000Z",
					archived: true,
					archivedAt: "2026-10-12T11:00:00.000Z",
				}),
			],
			null,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Archived/ })),
		);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});

		expect(
			within(archived)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual([
			"Archived lastmain",
			"Archived betweenmain",
			"Archived firstmain",
		]);
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
		const nav = view.getByRole("navigation", { name: "conversations" });
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Archived/ })),
		);
		const archived = view.getByRole("region", {
			name: "archived conversations",
		});

		await testing.remove("a2");

		expect(within(archived).getAllByRole("listitem")).toHaveLength(1);
		expect(archived.textContent).toContain("Put away");
		expect(archived.textContent).not.toContain("Older");
	});

	it("nests a part's conversations under the task it was handed out from", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
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
		const list = view.getByRole("list", { name: "conversation list" });

		expect(
			within(list)
				.getAllByRole("listitem")
				.filter((item) => item.parentElement === list)
				.map((item) => item.textContent),
		).toEqual(["Look around", "alphaalpha-api"]);
		expect(
			within(view.getByRole("list", { name: "parts of alpha" }))
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["alpha-api"]);
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

		expect(
			within(view.getByRole("list", { name: "parts of alpha" }))
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["alpha-api"]);
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
		const list = view.getByRole("list", { name: "conversation list" });

		expect(
			within(list)
				.getAllByRole("listitem")
				.filter((item) => item.parentElement === list)
				.map((item) => item.querySelector("span.truncate")?.textContent),
		).toEqual(["Look around", "split-b", "loose"]);
		expect(
			within(view.getByRole("list", { name: "parts of split-b" }))
				.getAllByRole("listitem")
				.map((item) => item.querySelector("span.truncate")?.textContent),
		).toEqual(["split-a", "split-c"]);
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

		expect(
			within(view.getByRole("list", { name: "parts of Orchestrate" }))
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["split-a"]);
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
		const nav = view.getByRole("navigation", { name: "conversations" });
		const names = within(nav)
			.getAllByRole("listitem")
			.map((item) => item.querySelector("span.truncate") as HTMLElement);

		expect(names.map((name) => name.textContent)).toEqual([
			"Not started",
			"fix the login",
			"Fix login",
			"alpha",
		]);
		expect(names.map((name) => name.classList.contains("italic"))).toEqual([
			true,
			true,
			false,
			false,
		]);
	});

	// scry-ignore simple-test-setup: the orchestrator and its lanes are what it checks, and no other test opens with them
	it("names a lane's orchestrator after its lanes, marked as a lane, over a task it took and the agent's title", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					title: "Arbor Lane 22",
					messages: [message("user", "[ARBOR LANE 22]")],
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
				conversation({
					id: "c2",
					task: "add-line",
					lastTask: "add-line",
					messages: [message("user", "[ARBOR LANE 20]\n[ARBOR LANE 9]")],
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c3",
					task: null,
					messages: [message("user", "[ARBOR LANE untriaged]")],
					createdAt: "2026-10-11T10:01:00.000Z",
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
		const nav = view.getByRole("navigation", { name: "conversations" });
		const items = within(nav).getAllByRole("listitem");
		const names = items.map(
			(item) => item.querySelector("span.truncate") as HTMLElement,
		);

		expect(names.map((name) => name.textContent)).toEqual([
			"Cloudflare Access",
			"Stats, Lane 9",
			"Untriaged",
			"alpha",
		]);
		expect(
			items.map((item) => within(item).queryByLabelText("Lane") !== null),
		).toEqual([true, true, true, false]);
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
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Claude Look around" })),
		);
		expect(branch()).toBe("main");
	});

	it("renames a conversation from its menu", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", title: "Fix login" })],
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
				conversation({ id: "c1", title: "Fix login", unread: true }),
				conversation({ id: "c2", title: "Fix footer" }),
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
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
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
