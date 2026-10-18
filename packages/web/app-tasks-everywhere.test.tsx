import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { EverywhereProject } from "@stringsync/splates-server/dev-everywhere";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

/** A project as `/api/everywhere` lists it, holding `tasks`. */
function listed(
	project: string,
	repo: string,
	root: string,
	tasks: Details[],
): EverywhereProject {
	return {
		project,
		repo,
		root,
		trunk: "main",
		tasks,
		laneNames: [],
		conversations: [],
	};
}

describe("App's tasks, every project's", () => {
	let testing: Testing;

	beforeEach(() => {
		localStorage.clear();
		testing = new Testing();
		// The fixture's snapshot is webappwiz's, at /repo.
		testing.everywhere = [
			listed("zebra", "zebra", "/code/zebra", [details({ task: "stripes" })]),
			listed("empty", "empty", "/code/empty", []),
			listed("webappwiz", "webappwiz", "/repo", [
				details({ task: "stale-listing" }),
			]),
			listed("apple", "apple", "/code/apple", [
				details({ task: "core" }),
				details({ task: "core-part", base: "task/core" }),
			]),
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		history.replaceState(null, "", location.pathname);
	});

	it("groups each project's tasks under its name, alphabetically, leaving out those with none", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "mine" })],
		});

		const groups = await waitFor(() => {
			const found = view.getAllByRole("region", { name: /^(?!tasks$)/ });
			expect(found.length).toBeGreaterThan(1);
			return found;
		});
		expect(
			groups
				.map((group) => group.getAttribute("aria-label"))
				.filter((name) =>
					["apple", "empty", "webappwiz", "zebra"].includes(name ?? ""),
				),
		).toEqual(["apple", "webappwiz", "zebra"]);
		// This project's are its snapshot's, which its dialog reads too.
		const mine = view.getByRole("list", { name: "webappwiz tasks" });
		expect(within(mine).getByRole("button", { name: /mine/ })).toBeTruthy();
		expect(
			within(mine).queryByRole("button", { name: /stale-listing/ }),
		).toBeNull();
		expect(
			within(view.getByRole("list", { name: "apple tasks" })).getByRole(
				"list",
				{ name: "parts of core" },
			),
		).toBeTruthy();
	});

	it("marks the conversations on another project's tasks", async () => {
		const stripes = details({ task: "stripes" });
		testing.everywhere = [
			{
				...listed("zebra", "zebra", "/code/zebra", [stripes]),
				conversations: [
					conversation({ id: "z1", task: "stripes", status: "running" }),
				],
			},
		];
		const view = await testing.openTasks({
			tasks: [details({ task: "mine" })],
		});
		const zebra = await waitFor(() =>
			view.getByRole("list", { name: "zebra tasks" }),
		);

		const row = within(zebra).getByRole("button", { name: /stripes/ });
		await waitFor(() =>
			expect(within(row).getAllByRole("status")).toHaveLength(1),
		);
	});

	it("opens this project's task in place", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({ task: "mine", plan: "# mine\n\n## Goal\n\nship it\n" }),
			],
		});
		const mine = await waitFor(() =>
			view.getByRole("list", { name: "webappwiz tasks" }),
		);

		await act(async () =>
			fireEvent.click(within(mine).getByRole("button", { name: /mine/ })),
		);

		expect(
			(await waitFor(() => view.getByRole("dialog"))).textContent,
		).toContain("ship it");
		expect(testing.visited).toEqual([]);
	});

	it("opens another project's task on that project's page, at the task", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "mine" })],
		});
		const zebra = await waitFor(() =>
			view.getByRole("list", { name: "zebra tasks" }),
		);

		await act(async () =>
			fireEvent.click(within(zebra).getByRole("button", { name: /stripes/ })),
		);

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#tasks/stripes");
	});

	it("folds a project's tasks away, and remembers it", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "mine" })],
		});
		const apple = await waitFor(() =>
			view.getByRole("region", { name: "apple" }),
		);

		await act(async () =>
			fireEvent.click(within(apple).getByRole("button", { name: /apple/ })),
		);

		await waitFor(() =>
			expect(view.queryByRole("list", { name: "apple tasks" })).toBeNull(),
		);
		expect(view.getByRole("list", { name: "zebra tasks" })).toBeTruthy();
		cleanup();

		const again = await testing.openTasks({
			tasks: [details({ task: "mine" })],
		});
		await waitFor(() => again.getByRole("list", { name: "zebra tasks" }));
		expect(again.queryByRole("list", { name: "apple tasks" })).toBeNull();
	});

	it("shows the empty page only when no project has tasks", async () => {
		testing.everywhere = [listed("empty", "empty", "/code/empty", [])];
		const view = await testing.openTasks({ tasks: [] });

		await waitFor(() => view.getByText("No tasks yet"));
	});
});
