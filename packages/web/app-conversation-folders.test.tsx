import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { EverywhereProject } from "@stringsync/splates-server/projects";
import {
	act,
	agentList,
	cleanup,
	conversation,
	fireEvent,
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
		conversations,
	};
}

describe("App's agents, in a folder per project", () => {
	let testing: Testing;
	const mine = [
		conversation({
			id: "c1",
			title: "Mine",
			status: "running",
			createdAt: "2026-10-11T10:01:00.000Z",
		}),
		conversation({
			id: "c2",
			title: "Mine broke",
			status: "failed",
			createdAt: "2026-10-11T10:02:00.000Z",
		}),
	];

	beforeEach(() => {
		localStorage.clear();
		testing = new Testing();
		// The fixture's snapshot is webappwiz's, at /repo.
		testing.everywhere = [
			listed("zebra", "/code/zebra", [
				conversation({ id: "z1", title: "Stripes", status: "running" }),
				conversation({ id: "z2", title: "Zebra broke", status: "failed" }),
			]),
			listed("apple", "/code/apple", []),
			listed("webappwiz", "/repo", []),
		];
	});

	afterEach(() => {
		cleanup();
		history.replaceState(null, "", location.pathname);
		testing.dispose();
	});

	/** The page, once every project's agents are in its sidebar. */
	const inbox = async () => {
		const view = await testing.openConversations(mine, null);
		const nav = agentList(view);
		await waitFor(() => within(nav).getByRole("region", { name: "zebra" }));
		return { view, nav };
	};

	it("puts every project's waiting agents in Needs you, each naming its project, then a folder per project, the waiting line counting them all", async () => {
		const { view, nav } = await inbox();

		const needsYou = within(nav).getByRole("region", { name: "Needs you" });
		expect(
			within(needsYou)
				.getAllByRole("button")
				.map((row) => row.textContent),
		).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Mine brokewebappwiz"),
				expect.stringContaining("Zebra brokezebra"),
			]),
		);
		// By name, leaving out a project with no agent.
		expect(
			within(nav)
				.getAllByRole("region")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["Needs you", "webappwiz", "zebra"]);
		const zebra = within(nav).getByRole("region", { name: "zebra" });
		expect(within(zebra).getByRole("button", { name: /Stripes/ })).toBeTruthy();
		expect(
			within(zebra).queryByRole("button", { name: /Zebra broke/ }),
		).toBeNull();
		expect(
			within(
				view.getByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
			).getByRole("status", {
				name: "2 waiting on you",
			}),
		).toBeTruthy();
	});

	it("lists every project's agents in the sidebar, another's opening on its page", async () => {
		const { view } = await inbox();
		const nav = view.getByRole("navigation", { name: "conversations" });
		await waitFor(() => within(nav).getByRole("button", { name: /Stripes/ }));

		// Those waiting, each naming its project, then this project's, the
		// fixture's external alpha among them, then zebra's.
		expect(
			within(nav)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual([
			"Mine brokewebappwiz",
			"Zebra brokezebra",
			"Mine",
			"alpha",
			"Stripes",
		]);
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Stripes/ })),
		);

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#conversations/z1");
	});

	it("starts a conversation in a folder's project from its +", async () => {
		const { nav } = await inbox();

		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "New conversation in zebra" }),
			),
		);

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#conversations/new");
	});

	it("folds a folder away, dotted while one of its agents waits, and remembers it", async () => {
		const { nav } = await inbox();
		const zebra = within(nav).getByRole("region", { name: "zebra" });
		expect(
			within(zebra).queryByRole("img", { name: "waiting on you" }),
		).toBeNull();

		await act(async () =>
			fireEvent.click(within(zebra).getByRole("button", { name: /^zebra/ })),
		);

		await waitFor(() =>
			expect(
				within(zebra).queryByRole("button", { name: /Stripes/ }),
			).toBeNull(),
		);
		expect(
			within(zebra).getByRole("img", { name: "waiting on you" }),
		).toBeTruthy();
		cleanup();

		const again = await inbox();
		const folded = within(again.nav).getByRole("region", { name: "zebra" });
		expect(
			within(folded).queryByRole("button", { name: /Stripes/ }),
		).toBeNull();
	});
});
