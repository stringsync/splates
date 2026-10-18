import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { EverywhereProject } from "@stringsync/splates-server/dev-everywhere";
import {
	act,
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

describe("App's sidebar, in a folder per project", () => {
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

	const sidebar = async () => {
		const view = await testing.openConversations(mine, null);
		const nav = view.getByRole("navigation", { name: "conversations" });
		await waitFor(() => within(nav).getByRole("region", { name: "zebra" }));
		return { view, nav };
	};

	it("puts every project's waiting agents in Needs you, each naming its project, then a folder per project", async () => {
		const { nav } = await sidebar();

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
		// By name, a project with no agent left to the row after them.
		expect(
			within(nav)
				.getAllByRole("region")
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["Needs you", "webappwiz", "zebra", "More projects"]);
		const zebra = within(nav).getByRole("region", { name: "zebra" });
		expect(within(zebra).getByRole("button", { name: /Stripes/ })).toBeTruthy();
		expect(
			within(zebra).queryByRole("button", { name: /Zebra broke/ }),
		).toBeNull();
		expect(
			within(nav).getByRole("button", { name: /\d waiting on you/ })
				.textContent,
		).toContain("2 waiting on you");
	});

	it("opens another project's agent on that project's page", async () => {
		const { nav } = await sidebar();
		const zebra = within(nav).getByRole("region", { name: "zebra" });

		await act(async () =>
			fireEvent.click(within(zebra).getByRole("button", { name: /Stripes/ })),
		);

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#conversations/z1");
	});

	it("starts a conversation in a folder's project from its +", async () => {
		const { nav } = await sidebar();

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
		const { nav } = await sidebar();
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

		const again = await sidebar();
		const folded = within(again.nav).getByRole("region", { name: "zebra" });
		expect(
			within(folded).queryByRole("button", { name: /Stripes/ }),
		).toBeNull();
	});

	it("folds the projects with no agent into one row, which starts a conversation in one and stays open", async () => {
		const { nav } = await sidebar();
		const more = within(nav).getByRole("region", { name: "More projects" });
		expect(within(more).queryByRole("button", { name: "apple" })).toBeNull();

		await act(async () =>
			fireEvent.click(
				within(more).getByRole("button", { name: "1 more project" }),
			),
		);
		await act(async () =>
			fireEvent.click(within(more).getByRole("button", { name: "apple" })),
		);

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("apple");
		expect(there.hash).toBe("#conversations/new");
		cleanup();

		const again = await sidebar();
		const opened = within(again.nav).getByRole("region", {
			name: "More projects",
		});
		expect(within(opened).getByRole("button", { name: "apple" })).toBeTruthy();
	});

	it("leaves the row out while every project has an agent", async () => {
		testing.everywhere = (testing.everywhere ?? []).filter(
			(each) => each.project !== "apple",
		);
		const { nav } = await sidebar();

		expect(
			within(nav).queryByRole("region", { name: "More projects" }),
		).toBeNull();
	});
});
