import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { EverywhereProject } from "@stringsync/splates-server/projects";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	cleanup,
	conversation,
	details,
	openQueueRow,
	queueRow,
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
		worktreeRoot: "/code/worktrees",
		lanesTaken: {},
		conversations: [],
	};
}

describe("App's Queue page, every project's tasks", () => {
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

	/** The names of the tasks Started by you lists, in its order. */
	const names = (view: Awaited<ReturnType<Testing["openTasks"]>>) =>
		within(view.getByRole("list", { name: "task list" }))
			.getAllByRole("listitem")
			.map((row) => row.querySelector(".truncate")?.textContent);

	it("lists every project's tasks in one list, by project, naming another project's on its row", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "mine" })],
		});

		await waitFor(() => queueRow(view, "stripes"));
		// A part is a row of its own; this project's are its snapshot's, which
		// its dialog reads too.
		expect(names(view)).toEqual(["core", "core-part", "mine", "stripes"]);
		expect(
			within(queueRow(view, "core")).getAllByText("apple"),
		).not.toHaveLength(0);
		expect(
			within(queueRow(view, "stripes")).getAllByText("zebra"),
		).not.toHaveLength(0);
		expect(queueRow(view, "mine").textContent).not.toContain("webappwiz");
		expect(view.queryByRole("region", { name: "apple" })).toBeNull();
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

		const row = await waitFor(() => queueRow(view, "stripes"));
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
		await waitFor(() => queueRow(view, "stripes"));

		await openQueueRow(view, "mine");

		expect(
			(await waitFor(() => view.getByRole("dialog"))).textContent,
		).toContain("ship it");
		expect(testing.visited).toEqual([]);
	});

	it("opens another project's task on that project's page, at the task", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "mine" })],
		});
		await waitFor(() => queueRow(view, "stripes"));

		await openQueueRow(view, "stripes");

		const there = new URL(String(testing.visited[0]));
		expect(there.searchParams.get("project")).toBe("zebra");
		expect(there.hash).toBe("#tasks/stripes");
	});

	it("says no task is at work when no project has one", async () => {
		testing.everywhere = [listed("empty", "empty", "/code/empty", [])];
		const view = await testing.openTasks({ tasks: [] });

		const yours = view.getByRole("region", { name: "Started by you" });
		await waitFor(() =>
			expect(within(yours).getByText("No tasks at work")).toBeTruthy(),
		);
		expect(view.queryByRole("region", { name: "empty" })).toBeNull();
	});

	it("lists other projects' tasks while this one has none", async () => {
		const view = await testing.openTasks({ tasks: [] });

		await waitFor(() => queueRow(view, "stripes"));
		expect(names(view)).toEqual(["core", "core-part", "stripes"]);
		expect(view.queryByText("No tasks at work")).toBeNull();
	});
});
