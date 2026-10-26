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

	it("lists every project in the sidebar by name, those with no conversations too", async () => {
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
		).toEqual(["apple", "shop", "webappwiz"]);
		expect(within(shop).getByText("Shop chat")).toBeTruthy();
	});

	it("lists every project in the inbox by name, those with no conversations too", async () => {
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
		).toEqual(["apple", "shop", "webappwiz"]);
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

	it("keeps another project's folder when its last conversation is removed by the stream", async () => {
		resize(390, 844);
		const view = await testing.openConversations([], null, { tasks: [] });
		await shopIn(agentList(view));
		await act(async () =>
			testing.everywhereStream?.named?.get("removed")?.({
				data: JSON.stringify({ project: "shop", id: "s1" }),
			}),
		);
		const shop = within(agentList(view)).getByRole("region", { name: "shop" });
		await waitFor(() =>
			expect(
				within(shop).queryByRole("link", { name: /Shop chat/ }),
			).toBeNull(),
		);
	});
	it("keeps another project's folder when the stream archives its last conversation", async () => {
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
		const shop = within(agentList(view)).getByRole("region", { name: "shop" });
		await waitFor(() =>
			expect(
				within(shop).queryByRole("link", { name: /Shop chat/ }),
			).toBeNull(),
		);
	});
	it("lists every project's folder when every project is empty", async () => {
		resize(390, 844);
		testing.everywhere = [
			listed("webappwiz", "/repo"),
			listed("shop", "/code/shop"),
		];
		const view = await testing.openConversations([], null, { tasks: [] });
		const list = agentList(view);
		await shopIn(list);
		expect(
			within(list).getByRole("region", { name: "webappwiz" }),
		).toBeTruthy();
		expect(
			within(list).queryByText("No conversations yet. Start one below."),
		).toBeNull();
		expect(
			within(list).getByRole("button", { name: "Add a project" }),
		).toBeTruthy();
	});
});
