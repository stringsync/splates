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
		await waitFor(() => within(nav).getByRole("region", { name: "zebra" }));
		return { view, nav };
	};

	it("lists every project with agents in a folder, the page's own first, each with its waiting agents on top and counted in its header", async () => {
		const { view, nav } = await inbox();

		// Empty projects left out, and no Needs you across them.
		expect(
			within(nav)
				.getAllByRole("region")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["webappwiz", "zebra"]);
		expect(
			within(nav)
				.getAllByRole("region")
				.map((folder) => [
					within(folder)
						.getAllByRole("listitem")
						.map((item) => item.textContent),
					within(folder)
						.getByRole("status", { name: /^\d+ waiting on you$/ })
						.getAttribute("aria-label"),
				]),
		).toEqual([
			[["Mine broke", "Mine"], "1 waiting on you"],
			[["Zebra broke", "Stripes"], "1 waiting on you"],
		]);
		expect(
			within(
				view.getByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
			).getByRole("status", {
				name: "2 waiting on you",
			}),
		).toBeTruthy();
	});

	it("opens another project's agent on its page", async () => {
		const { nav } = await inbox();

		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Zebra broke/ })),
		);

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#conversations/z2");
	});

	it("keeps the folders by name, the page's own among them marked, so a switch moves none", async () => {
		testing.everywhere = [
			listed("apple", "/code/apple", [
				conversation({ id: "a1", title: "Core", status: "running" }),
			]),
			listed("webappwiz", "/repo", []),
		];
		const view = await testing.openConversations(mine, null);
		const nav = agentList(view);
		await waitFor(() => within(nav).getByRole("region", { name: "apple" }));

		expect(
			within(nav)
				.getAllByRole("region")
				.map((each) => [
					each.getAttribute("aria-label"),
					within(each).queryByRole("img", { name: "shown" }) !== null,
				]),
		).toEqual([
			["apple", false],
			["webappwiz", true],
		]);
	});

	it("lists every agent of every project, none held back", async () => {
		testing.everywhere = [
			listed(
				"zebra",
				"/code/zebra",
				Array.from({ length: 7 }, (_, at) =>
					conversation({
						id: `z${at}`,
						title: `Stripe ${at}`,
						createdAt: `2026-10-11T10:0${at}:00.000Z`,
					}),
				),
			),
			listed("webappwiz", "/repo", []),
		];
		const { nav } = await inbox();

		expect(
			within(within(nav).getByRole("region", { name: "zebra" })).getAllByRole(
				"listitem",
			),
		).toHaveLength(7);
		expect(within(nav).queryByRole("button", { name: /more$/ })).toBeNull();
	});

	it("folds a project away, as this browser keeps it", async () => {
		const { nav } = await inbox();
		const zebra = within(nav).getByRole("region", { name: "zebra" });

		await act(async () =>
			fireEvent.click(within(zebra).getByRole("button", { name: /^zebra/ })),
		);

		expect(within(zebra).queryByRole("button", { name: /Stripes/ })).toBeNull();
		expect(
			JSON.parse(localStorage.getItem("splates.sidebar.collapsed") ?? "[]"),
		).toEqual(["zebra"]);
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
		).toEqual(["Mine broke", "Mane", "Mine"]);
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
		).toEqual(["Mine broke", "Pinned", "Mine", "Groomer", "Review merged"]);
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
				expect.stringContaining("Mine broke"),
				expect.stringContaining("Mine"),
				expect.stringContaining("Groomer"),
			]);
			expect(within(here).queryByRole("separator")).toBeNull();
		} finally {
			resize(1024, 768);
		}
	});

	it("starts a conversation in another project from its +, on its page", async () => {
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

	it("starts a conversation in the page's own project from its +", async () => {
		const { nav } = await inbox();

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
