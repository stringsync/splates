import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
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
				conversation({
					id: "z1",
					title: "Stripes",
					status: "running",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "z2",
					title: "Zebra broke",
					status: "failed",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
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
		await waitFor(() =>
			within(nav).getByRole("region", { name: "Other projects" }),
		);
		return { view, nav };
	};

	it("gathers every project's waiting agents in Needs you, above the page's own project and the other projects, the waiting line counting them all", async () => {
		const { view, nav } = await inbox();

		// Empty projects left out.
		expect(
			within(nav)
				.getAllByRole("region")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["Needs you", "webappwiz", "Other projects"]);
		const needsYou = within(nav).getByRole("list", {
			name: "Needs you conversations",
		});
		expect(
			within(needsYou)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Mine broke", "Zebra brokezebra"]);
		expect(
			within(needsYou).getAllByRole("status", { name: "waiting on you" }),
		).toHaveLength(2);
		expect(
			within(within(nav).getByRole("list", { name: "webappwiz conversations" }))
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Mine"]);
		expect(
			within(
				view.getByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
			).getByRole("status", {
				name: "2 waiting on you",
			}),
		).toBeTruthy();
	});

	it("opens another project's waiting agent from Needs you on its page", async () => {
		const { nav } = await inbox();

		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Zebra broke/ })),
		);

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#conversations/z2");
	});

	it("shows each other project as one line with how many are at work and a waiting warning, switching the page to it", async () => {
		const { nav } = await inbox();
		const others = within(nav).getByRole("region", { name: "Other projects" });

		expect(within(nav).queryByRole("button", { name: /Stripes/ })).toBeNull();
		const zebra = within(others).getByRole("button", { name: /^zebra/ });
		expect(zebra.textContent).toBe("zebra1 at work");
		expect(
			within(zebra).getByRole("img", { name: "waiting on you" }),
		).toBeTruthy();
		await act(async () => fireEvent.click(zebra));

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#conversations");
	});

	it("lists the page's own project's pinned agents first, above those at work", async () => {
		const view = await testing.openConversations(
			[
				...mine,
				conversation({
					id: "c3",
					title: "Mane",
					pinned: true,
					createdAt: "2026-10-11T10:00:00.000Z",
				}),
			],
			null,
		);
		const list = await waitFor(() =>
			within(agentList(view)).getByRole("list", {
				name: "webappwiz conversations",
			}),
		);

		expect(
			within(list)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Mane", "Mine"]);
	});

	// scry-ignore simple-test-setup: this test alone lists these automations among the folder's conversations.
	it("lists a folder's automations among its conversations by recency, untagged, each with an Archive", async () => {
		const view = await testing.openConversations(
			[
				...mine,
				conversation({
					id: "g1",
					title: "Groomer",
					persistent: "groomer",
					createdAt: "2026-10-11T10:01:30.000Z",
				}),
				conversation({
					id: "h1",
					title: "Review merged",
					automation: "a1",
					createdAt: "2026-10-11T09:00:00.000Z",
				}),
				conversation({
					id: "c3",
					title: "Pinned",
					pinned: true,
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
		);
		const nav = agentList(view);
		const here = await waitFor(() =>
			within(nav).getByRole("region", { name: "webappwiz" }),
		);

		expect(
			within(
				within(here).getByRole("list", { name: "webappwiz conversations" }),
			)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Pinned", "Mine", "Groomer", "Review merged"]);
		expect(within(here).queryByText("Automation")).toBeNull();
		expect(within(here).queryByRole("separator")).toBeNull();
		expect(
			within(here).getByRole("button", { name: "Archive Groomer" }),
		).toBeDefined();
		expect(
			within(here).getByRole("button", { name: "Archive Mine" }),
		).toBeTruthy();
	});

	it("drops a persistent agent's row between runs", async () => {
		const view = await testing.openConversations(
			[
				...mine,
				conversation({
					id: "g1",
					title: "Groomer",
					persistent: "groomer",
					createdAt: "2026-10-11T09:30:00.000Z",
					archived: true,
					resting: true,
				}),
			],
			null,
		);
		const here = await waitFor(() =>
			within(agentList(view)).getByRole("region", { name: "webappwiz" }),
		);

		expect(within(here).queryByText("Groomer")).toBeNull();
	});

	it("lists a folder's automations among its conversations in a phone's inbox", async () => {
		resize(390, 844);
		try {
			const view = await testing.openConversations(
				[
					...mine,
					conversation({
						id: "g1",
						title: "Groomer",
						persistent: "groomer",
						createdAt: "2026-10-11T09:00:00.000Z",
					}),
				],
				null,
			);
			const here = await waitFor(() =>
				within(view.getByRole("region", { name: "inbox" })).getByRole(
					"region",
					{ name: "webappwiz" },
				),
			);

			expect(
				within(here)
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual([
				expect.stringContaining("Mine"),
				expect.stringContaining("Groomer"),
			]);
			expect(within(here).queryByRole("separator")).toBeNull();
		} finally {
			resize(1024, 768);
		}
	});

	it("starts a conversation in the page's own project from its +, and in no other", async () => {
		const { nav } = await inbox();
		expect(
			within(nav).queryByRole("button", { name: "New conversation in zebra" }),
		).toBeNull();

		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", {
					name: "New conversation in webappwiz",
				}),
			),
		);

		expect(location.hash).toBe("#conversations/new");
		expect(testing.visited).toEqual([]);
	});
});
