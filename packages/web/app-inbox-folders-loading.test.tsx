import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { EverywhereProject } from "@stringsync/splates-server/projects";
import {
	act,
	agentList,
	cleanup,
	conversation,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

/** A project as `/api/everywhere` lists it, holding `conversations`. */
function listed(
	project: string,
	root: string,
	conversations: ConversationState[],
): EverywhereProject {
	return {
		project,
		repo: project,
		root,
		trunk: "main",
		tasks: [],
		laneNames: [],
		worktreeRoot: "/code/worktrees",
		lanesTaken: {},
		conversations,
	};
}

describe("App's folders while every project's listing is on its way", () => {
	let testing: Testing;
	const mine = [conversation({ id: "c1", title: "Mine", status: "running" })];
	const everywhere = [
		listed("zebra", "/code/zebra", [
			conversation({ id: "z1", title: "Stripes", status: "running" }),
		]),
		listed("webappwiz", "/repo", []),
	];

	beforeEach(() => {
		localStorage.clear();
		testing = new Testing();
		testing.everywhere = everywhere;
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
	});

	it("holds the sidebar's rows until every project is listed, rather than drawing them flat and moving them into folders", async () => {
		testing.hang("/api/everywhere");
		const view = await testing.openConversations(mine, null);

		const nav = agentList(view);
		expect(
			within(nav).getByRole("status", { name: "Loading conversations" }),
		).toBeTruthy();
		expect(within(nav).queryByText("Mine")).toBeNull();

		testing.unhang();
		await act(async () =>
			testing.everywhereStream?.named?.get("projects")?.({ data: "" }),
		);

		await waitFor(() => within(nav).getByRole("region", { name: "zebra" }));
		expect(
			within(nav).queryByRole("status", { name: "Loading conversations" }),
		).toBeNull();
		expect(
			within(within(nav).getByRole("region", { name: "webappwiz" })).getByText(
				"Mine",
			),
		).toBeTruthy();
	});

	it("draws the sidebar's folders from the copy kept last time before the server lists every project", async () => {
		testing.hang("/api/everywhere");
		testing.copies.save("everywhere", {
			build: "",
			value: { projects: everywhere },
		});
		const view = await testing.openConversations(mine, null);

		const nav = agentList(view);
		await waitFor(() => within(nav).getByRole("region", { name: "zebra" }));
		expect(
			within(nav).queryByRole("status", { name: "Loading conversations" }),
		).toBeNull();
		expect(within(nav).getByText("Stripes")).toBeTruthy();
	});

	it("draws a phone's inbox folders from the copy kept last time before the server lists every project", async () => {
		resize(390, 844);
		testing.hang("/api/everywhere");
		testing.copies.save("everywhere", {
			build: "",
			value: { projects: everywhere },
		});
		const view = await testing.openConversations(mine, null);

		const inbox = view.getByRole("region", { name: "inbox" });
		await waitFor(() => within(inbox).getByRole("region", { name: "zebra" }));
		expect(
			within(inbox).queryByRole("status", { name: "Loading inbox" }),
		).toBeNull();
		expect(within(inbox).getByText("Stripes")).toBeTruthy();
	});
});
