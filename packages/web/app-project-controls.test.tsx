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
		await waitFor(() => within(list).getByRole("region", { name: "shop" }));
		expect(
			within(list).queryByRole("button", { name: "Add a project" }),
		).toBeNull();
	});

	it("offers adding a project in the inbox", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await waitFor(() => within(list).getByRole("region", { name: "shop" }));
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

	it("hides empty projects in the sidebar", async () => {
		resize(1024, 768);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		const shop = await waitFor(() =>
			within(list).getByRole("region", { name: "shop" }),
		);
		expect(
			within(list).queryByRole("region", { name: "webappwiz" }),
		).toBeNull();
		expect(
			within(shop).getByRole("button", { name: /Shop chat/ }),
		).toBeTruthy();
	});

	it("offers removing projects in the sidebar", async () => {
		resize(1024, 768);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await waitFor(() => within(list).getByRole("region", { name: "shop" }));
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

	it("hides empty projects in the inbox", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		const shop = await waitFor(() =>
			within(list).getByRole("region", { name: "shop" }),
		);
		expect(
			within(list).queryByRole("region", { name: "webappwiz" }),
		).toBeNull();
		expect(
			within(shop).getByRole("button", { name: /Shop chat/ }),
		).toBeTruthy();
	});

	it("offers removing projects in the inbox", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await waitFor(() => within(list).getByRole("region", { name: "shop" }));
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

	it("hides the project after swiping away its last conversation and restores it when unarchived", async () => {
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
			expect(
				within(list).queryByRole("region", { name: "webappwiz" }),
			).toBeNull(),
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
				within(list).getByRole("region", { name: "webappwiz" }),
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
		expect(within(list).getByRole("region", { name: "shop" })).toBeTruthy();
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
		const chat = conversation({
			id: "s1",
			task: null,
			title: "Shop chat",
			status: "stopped",
		});
		testing.everywhere = [
			listed("webappwiz", "/repo"),
			{ ...listed("shop", "/code/shop"), conversations: [chat] },
		];
		const view = await testing.openConversations([], null, { tasks: [] });
		const shop = await waitFor(() =>
			within(agentList(view)).getByRole("region", { name: "shop" }),
		);
		expect(
			within(shop).getByRole("button", { name: /Shop chat/ }),
		).toBeTruthy();
		await act(async () =>
			testing.everywhereStream?.named?.get("removed")?.({
				data: JSON.stringify({ project: "shop", id: "s1" }),
			}),
		);
		expect(
			within(agentList(view)).queryByRole("region", { name: "shop" }),
		).toBeNull();
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
