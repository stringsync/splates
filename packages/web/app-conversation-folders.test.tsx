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

	it("leaves every project's waiting agents in place in a folder per project, marked waiting, the waiting line counting them all", async () => {
		const { view, nav } = await inbox();

		// By name, leaving out empty projects, and no Needs you above them.
		expect(
			within(nav)
				.getAllByRole("region")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["webappwiz", "zebra"]);
		const webappwiz = within(nav).getByRole("region", { name: "webappwiz" });
		const mine = within(webappwiz)
			.getAllByRole("listitem")
			.find((item) => item.textContent === "Mine broke");
		expect(
			within(mine as HTMLElement).getByRole("status", {
				name: "waiting on you",
			}),
		).toBeTruthy();
		const zebra = within(nav).getByRole("region", { name: "zebra" });
		expect(within(zebra).getByRole("button", { name: /Stripes/ })).toBeTruthy();
		const broke = within(zebra)
			.getAllByRole("listitem")
			.find((item) => item.textContent === "Zebra broke");
		expect(
			within(broke as HTMLElement).getByRole("status", {
				name: "waiting on you",
			}),
		).toBeTruthy();
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

		// This project's, those waiting among them, but for the fixture's
		// external alpha, which the Tasks page lists, then zebra's.
		expect(
			within(nav)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Mine broke", "Mine", "Stripes", "Zebra broke"]);
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: /Stripes/ })),
		);

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#conversations/z1");
	});

	it("lists a folder's pinned agents first, above those at work", async () => {
		testing.everywhere = [
			listed("zebra", "/code/zebra", [
				conversation({
					id: "z1",
					title: "Stripes",
					status: "running",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "z3",
					title: "Mane",
					pinned: true,
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
			]),
		];
		const { view } = await inbox();
		const nav = view.getByRole("navigation", { name: "conversations" });
		const zebra = await waitFor(() =>
			within(nav).getByRole("region", { name: "zebra" }),
		);

		expect(
			within(zebra)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Mane", "Stripes"]);
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
		).toEqual(["Pinned", "Mine broke", "Mine", "Groomer", "Review merged"]);
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
