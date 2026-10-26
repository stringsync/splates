import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { EverywhereProject } from "@stringsync/splates-server/projects";
import {
	act,
	agentList,
	cleanup,
	conversation,
	fireEvent,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

function listed(project: string, root: string): EverywhereProject {
	return {
		project,
		root,
		repo: project,
		trunk: "main",
		tasks: [],
		conversations: [],
		laneNames: [],
		lanesTaken: {},
		worktreeRoot: "/code/worktrees",
	};
}

/** Shop's folder in `list`, once every project is listed. */
function shopIn(list: HTMLElement): Promise<HTMLElement> {
	return waitFor(() => within(list).getByRole("region", { name: "shop" }));
}

describe("Project controls in conversation lists", () => {
	let testing: Testing;
	beforeEach(() => {
		localStorage.clear();
		testing = new Testing();
		testing.everywhere = [
			listed("webappwiz", "/repo"),
			{
				...listed("shop", "/code/shop"),
				conversations: [
					conversation({
						id: "s1",
						task: null,
						title: "Shop chat",
						status: "stopped",
					}),
				],
			},
		];
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
		localStorage.clear();
	});

	it("leaves adding a project out of the sidebar", async () => {
		resize(1024, 768);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await shopIn(list);
		expect(
			within(list).queryByRole("button", { name: "Add a project" }),
		).toBeNull();
	});

	it("offers adding a project in the inbox", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await shopIn(list);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Add a project" }),
			),
		);
		const add = view.getByRole("dialog", { name: "Add a project" });
		expect(
			within(add).getByRole("textbox", { name: "project path" }),
		).toBeTruthy();
		await act(async () => fireEvent.keyDown(add, { key: "Escape" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
	});

	it("shows the page's own project in the sidebar with no conversations, and other projects only with some", async () => {
		resize(1024, 768);
		testing.everywhere = [
			...(testing.everywhere ?? []),
			listed("apple", "/code/apple"),
		];
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		const shop = await shopIn(list);
		expect(
			within(within(list).getByRole("region", { name: "webappwiz" })).getByText(
				"No conversations yet.",
			),
		).toBeTruthy();
		expect(
			within(list)
				.getAllByRole("region")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["webappwiz", "shop"]);
		expect(within(shop).getByText("Shop chat")).toBeTruthy();
	});

	it("offers removing projects in the sidebar", async () => {
		resize(1024, 768);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await shopIn(list);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Remove project shop" }),
			),
		);
		const remove = view.getByRole("dialog", { name: "Remove project shop?" });
		expect(
			within(remove).getByText(/files and conversation history are kept/),
		).toBeTruthy();
		expect(testing.posts).toHaveLength(0);
		testing.reply = { next: { slug: "webappwiz" } };
		await act(async () =>
			fireEvent.click(
				within(remove).getByRole("button", { name: "Remove project" }),
			),
		);
		expect(testing.posts).toContainEqual(
			expect.objectContaining({
				path: "/api/projects/shop",
				method: "DELETE",
			}),
		);
		expect(testing.visited).toHaveLength(0);
	});

	it("shows the page's own project in the inbox with no conversations, and other projects only with some", async () => {
		resize(390, 844);
		testing.everywhere = [
			...(testing.everywhere ?? []),
			listed("apple", "/code/apple"),
		];
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		const shop = await shopIn(list);
		expect(
			within(within(list).getByRole("region", { name: "webappwiz" })).getByText(
				"No conversations yet.",
			),
		).toBeTruthy();
		expect(
			within(list)
				.getAllByRole("region")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["webappwiz", "shop"]);
		expect(within(shop).getByText("Shop chat")).toBeTruthy();
	});

	it("offers adding a project in the phone's drawer", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		const drawer = await waitFor(() =>
			view.getByRole("dialog", { name: "Pages" }),
		);
		await act(async () =>
			fireEvent.click(
				within(drawer).getByRole("button", { name: "Add a project" }),
			),
		);
		const add = await waitFor(() =>
			view.getByRole("dialog", { name: "Add a project" }),
		);
		expect(
			within(add).getByRole("textbox", { name: "project path" }),
		).toBeTruthy();
		expect(view.queryByRole("dialog", { name: "Pages" })).toBeNull();
	});

	it("opens the page's own project's menu on a long press of its name", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await shopIn(list);
		const here = within(list).getByRole("region", { name: "webappwiz" });
		// As Android holds a row: the finger down, then the context menu.
		const head = within(here).getByRole("button", { name: "webappwiz" });
		await act(async () => {
			fireEvent.pointerDown(head);
			fireEvent.contextMenu(head);
			fireEvent.click(head);
		});
		const menu = view.getByRole("dialog", { name: "webappwiz" });
		expect(
			within(menu).getByRole("button", { name: "New conversation" }),
		).toBeTruthy();
		expect(
			within(menu).getByRole("button", { name: "Remove project…" }),
		).toBeTruthy();
		await act(async () => fireEvent.keyDown(menu, { key: "Escape" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
	});

	it("offers removing a project from its menu in the inbox", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await shopIn(list);
		expect(
			within(list).queryByRole("button", { name: /^Remove project/ }),
		).toBeNull();
		expect(
			within(list).getByRole("button", { name: "Menu for shop" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Menu for webappwiz" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog", { name: "webappwiz" })).getByRole(
					"button",
					{ name: "Remove project…" },
				),
			),
		);
		const remove = await waitFor(() =>
			view.getByRole("dialog", { name: "Remove project webappwiz?" }),
		);
		expect(
			within(remove).getByText(/files and conversation history are kept/),
		).toBeTruthy();
		expect(testing.posts).toHaveLength(0);
		testing.reply = { next: { slug: "shop" } };
		await act(async () =>
			fireEvent.click(
				within(remove).getByRole("button", { name: "Remove project" }),
			),
		);
		expect(testing.posts).toContainEqual(
			expect.objectContaining({
				path: "/api/projects/webappwiz",
				method: "DELETE",
			}),
		);
		expect(
			new URL(String(testing.visited.at(-1))).searchParams.get("project"),
		).toBe("shop");
	});

	it("empties the page's own project after swiping away its last conversation and lists it again when unarchived", async () => {
		resize(390, 844);
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					title: "Last chat",
					status: "stopped",
				}),
			],
			null,
			{ tasks: [] },
		);
		const list = agentList(view);
		const here = await waitFor(() =>
			within(list).getByRole("region", { name: "webappwiz" }),
		);
		const row = within(here).getByRole("button", { name: /Last chat/ });
		await act(async () => {
			fireEvent.pointerDown(row, { clientX: 370, clientY: 100, pointerId: 1 });
			fireEvent.pointerMove(row, { clientX: 190, clientY: 100, pointerId: 1 });
			fireEvent.pointerUp(row, { clientX: 190, clientY: 100, pointerId: 1 });
		});
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/archived")).toHaveLength(1),
		);
		await waitFor(() =>
			expect(within(here).getByText("No conversations yet.")).toBeTruthy(),
		);
		await act(async () =>
			testing.say(
				conversation({
					id: "c1",
					task: null,
					title: "Last chat",
					status: "stopped",
					archived: false,
				}),
			),
		);
		await waitFor(() =>
			expect(
				within(here).getByRole("button", { name: /Last chat/ }),
			).toBeTruthy(),
		);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("keeps removal open with a reason when the server refuses", async () => {
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		const remove = await waitFor(() =>
			within(list).getByRole("button", { name: "Remove project shop" }),
		);
		await act(async () => fireEvent.click(remove));
		const dialog = view.getByRole("dialog", { name: "Remove project shop?" });
		testing.refuseWrites = { reason: "locked", message: "try later" };
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Remove project" }),
			),
		);
		await waitFor(() =>
			expect(within(dialog).getByRole("alert").textContent).toContain(
				"try later",
			),
		);
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(within(await shopIn(list)).getByText("Shop chat")).toBeTruthy();
	});
	it("moves to the previous project when removing the one shown", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					title: "Here",
					status: "stopped",
				}),
			],
			null,
			{ tasks: [] },
		);
		const button = await waitFor(() =>
			within(agentList(view)).getByRole("button", {
				name: "Remove project webappwiz",
			}),
		);
		await act(async () => fireEvent.click(button));
		testing.reply = { next: { slug: "shop" } };
		const dialog = view.getByRole("dialog", {
			name: "Remove project webappwiz?",
		});
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Remove project" }),
			),
		);
		expect(
			new URL(String(testing.visited.at(-1))).searchParams.get("project"),
		).toBe("shop");
	});
	it("hides another project's folder when its last conversation is removed by the stream", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		await shopIn(agentList(view));
		await act(async () =>
			testing.everywhereStream?.named?.get("removed")?.({
				data: JSON.stringify({ project: "shop", id: "s1" }),
			}),
		);
		expect(
			within(agentList(view)).queryByRole("region", { name: "shop" }),
		).toBeNull();
	});
	it("hides another project's folder when the stream archives its last conversation", async () => {
		const view = await testing.openConversations([], null, { tasks: [] });
		await shopIn(agentList(view));
		await act(async () =>
			testing.everywhereStream?.onmessage?.({
				data: JSON.stringify({
					project: "shop",
					conversation: conversation({
						id: "s1",
						task: null,
						title: "Shop chat",
						status: "stopped",
						archived: true,
					}),
				}),
			}),
		);
		await waitFor(() =>
			expect(
				within(agentList(view)).queryByRole("region", { name: "shop" }),
			).toBeNull(),
		);
	});
	it("shows the inbox empty state when every project is empty", async () => {
		resize(390, 844);
		testing.everywhere = [
			listed("webappwiz", "/repo"),
			listed("shop", "/code/shop"),
		];
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await waitFor(() =>
			expect(
				within(list).getByText("No conversations yet. Start one below."),
			).toBeTruthy(),
		);
		expect(
			within(list).queryByRole("region", { name: "webappwiz" }),
		).toBeNull();
		expect(within(list).queryByRole("region", { name: "shop" })).toBeNull();
		expect(
			within(list).getByRole("button", { name: "Add a project" }),
		).toBeTruthy();
	});
});
