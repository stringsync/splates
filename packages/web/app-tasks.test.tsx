import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

describe("App's tasks", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("heads the tasks with a title, with tasks or without", async () => {
		const view = await testing.openTasks({ tasks: [] });

		expect(view.getByRole("heading", { name: "Tasks" })).toBeTruthy();
		expect(view.getByText(/No tasks/)).toBeTruthy();
	});

	it("opens a task's plan, and where it stands", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({ task: "alpha" }),
				details({
					task: "beta",
					plan: "# beta\n\n## Goal\n\nship the thing\n",
				}),
			],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /beta/ })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("ship the thing");
		expect(within(dialog).getByText("Working")).toBeTruthy();
	});

	it("shows a coming conflict on the row and names its files in the dialog", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "alpha", comingConflict: ["src/shared.ts"] })],
		});
		expect(view.getByText("Coming conflict")).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /alpha/ })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByRole("alert").textContent).toContain(
			"src/shared.ts",
		);
		expect(within(dialog).getByText("Coming conflict with main")).toBeTruthy();
	});

	it("nests each part under the task it was handed out from", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({ task: "alpha-api", base: "task/alpha" }),
				details({ task: "alpha" }),
				details({ task: "beta" }),
			],
		});

		const parts = view.getByRole("list", { name: "parts of alpha" });
		expect(
			within(parts).getByRole("button", { name: /alpha-api/ }),
		).toBeTruthy();
		expect(
			[...view.getByRole("list", { name: "task list" }).children].map(
				(item) =>
					item.firstElementChild?.querySelector(".truncate")?.textContent,
			),
		).toEqual(["alpha", "beta"]);
	});

	it("opens a task's changes in a pane beside the page, a file to a line, opening all at once", async () => {
		testing.diffs.alpha = [
			{
				path: "src/a.ts",
				from: null,
				status: "modified",
				added: 1,
				removed: 1,
				binary: false,
				uncommitted: false,
				hunks: [
					{
						range: "@@ -1,2 +1,2 @@",
						lines: [
							{ kind: "context", text: "keep" },
							{ kind: "removed", text: "old" },
							{ kind: "added", text: "new" },
						],
					},
				],
			},
			{
				path: "logo.png",
				from: null,
				status: "added",
				added: 0,
				removed: 0,
				binary: true,
				uncommitted: true,
				hunks: [],
			},
		];
		const view = await testing.openTasks({
			tasks: [details({ task: "alpha" })],
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /alpha/ })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).not.toContain("src/a.ts");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Review changes" })),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		const changes = await waitFor(() =>
			view.getByRole("complementary", { name: "changes in alpha" }),
		);
		const [first, second] = [...changes.querySelectorAll("summary")];
		expect(first?.textContent).toBe("src/a.ts+1 −1");
		expect(second?.textContent).toBe("logo.pngnewuncommitted+0 −0");
		expect(view.getByLabelText("src/a.ts @@ -1,2 +1,2 @@").textContent).toBe(
			"@@ -1,2 +1,2 @@+1 −1keep−old+new",
		);

		const files = [...changes.querySelectorAll("details")];
		expect(files.map((file) => file.open)).toEqual([false, false]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Expand all" })),
		);
		expect(files.map((file) => file.open)).toEqual([true, true]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Collapse all" })),
		);
		expect(files.map((file) => file.open)).toEqual([false, false]);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Close changes" })),
		);
		expect(view.queryByRole("complementary")).toBeNull();
	});

	// scry-ignore simple-test-setup: the spent merge attempts belong only to this retry test, not shared setup
	it("grants a task out of merge attempts another round, saying so where it was asked", async () => {
		const spent = { task: "alpha", mergeAttempts: 3 };
		const view = await testing.openTasks({
			tasks: [
				details(spent),
				details({ ...spent, task: "beta", mergeAttempts: 1 }),
			],
		});

		// With attempts left, a task has no use for more.
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /beta/ })),
		);
		const other = await waitFor(() => view.getByRole("dialog"));
		expect(other.textContent).toContain("1 of 3 merges tried");
		expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Close" })),
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /alpha/ })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Retry" })),
			),
		);

		await waitFor(() =>
			expect(testing.posts.map((post) => post.path)).toEqual([
				"/api/tasks/alpha/retry",
			]),
		);
		// The page reads the task as working again, and the button stays to say so.
		testing.served = {
			...testing.served,
			tasks: [details({ task: "alpha", status: "working" })],
		};
		await act(async () => testing.stream?.onmessage?.());
		const retried = await waitFor(() =>
			view.getByRole("button", { name: "Retried" }),
		);
		expect(retried.hasAttribute("disabled")).toBe(true);
		expect(view.getByRole("dialog").textContent).toContain(
			"splates claim alpha picks it up",
		);
	});

	it("says in the dialog why a retry was refused", async () => {
		testing.refuseWrites = {
			reason: "usage",
			message: "'alpha' has spent 1 of its 3 merge attempts",
		};
		const view = await testing.openTasks({
			tasks: [details({ mergeAttempts: 3 })],
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /alpha/ })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Retry" })),
			),
		);

		await waitFor(() =>
			expect(view.getByRole("dialog").textContent).toContain(
				"'alpha' has spent 1 of its 3 merge attempts",
			),
		);
		expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("shows elapsed time beside a task without its plan or review", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({
					task: "alpha",
					plan: "# alpha\n\n## Done\n\n- [x] one\n\n## Next\n\n- [ ] two\n",
				}),
			],
		});

		const row = view.getByRole("button", { name: /alpha/ });
		expect(row.textContent).toContain("alpha");
		expect(row.textContent).toContain("Elapsed:");
		expect(view.queryByRole("progressbar")).toBeNull();
	});

	it("shows how each conversation on a task stands in its row, not whose agent it is", async () => {
		testing.talk = {
			agents: [],
			conversations: [
				conversation({
					id: "c1",
					task: "alpha",
					status: "running",
					ask: {
						type: "permission",
						id: "t1",
						at: "2026-10-11T10:00:00.000Z",
						title: "rm -rf build",
						options: [{ id: "yes", name: "Allow", kind: "allow_once" }],
					},
				}),
			],
		};
		const view = await testing.openTasks({
			tasks: [details({ task: "alpha" })],
		});

		const row = within(view.getByRole("list", { name: "task list" })).getByRole(
			"button",
			{ name: /alpha/ },
		);
		await waitFor(() =>
			within(row).getByRole("status", { name: "waiting on you" }),
		);
		expect(within(row).queryByRole("img")).toBeNull();
	});
});
