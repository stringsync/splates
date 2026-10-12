import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, details, fireEvent, Testing, waitFor } from "./testing";

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

	it("flags only the statuses that are news, and opens a task's plan", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({ task: "alpha" }),
				details({
					task: "beta",
					status: "escalated",
					escalation: "needs eyes",
					plan: "# beta\n\n## Goal\n\nship the thing\n",
				}),
			],
		});

		expect(view.queryByText("working")).toBeNull();
		expect(view.queryByRole("progressbar")).toBeNull();
		expect(view.getByText("escalated")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /beta/ })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("ship the thing");
		expect(dialog.textContent).toContain("needs eyes");
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
		expect(parts.textContent).toBe("alpha-api");
		expect(
			[...view.getByRole("list", { name: "task list" }).children].map(
				(item) => item.firstElementChild?.textContent,
			),
		).toEqual(["alpha", "beta"]);
	});

	it("marks a task waiting on approval as ready to merge, saying what to look at", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({
					task: "alpha",
					status: "escalated",
					escalation: "drag a todo at http://localhost:4269",
					review: "drag a todo at http://localhost:4269",
				}),
			],
		});

		expect(view.getByText("ready to merge")).toBeTruthy();
		expect(view.queryByText("escalated")).toBeNull();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /alpha/ })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain(
			"Ready to merge: drag a todo at http://localhost:4269",
		);
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

	it("grants a task out of merge attempts another round, saying so where it was asked", async () => {
		const spent = {
			task: "alpha",
			status: "escalated",
			escalation: "merge keeps conflicting",
			mergeAttempts: 3,
		};
		const view = await testing.openTasks({
			tasks: [
				details(spent),
				details({ ...spent, task: "beta", mergeAttempts: 1 }),
			],
		});

		// Escalated for some other reason, a task has no use for more attempts.
		expect(view.getByText("out of merges")).toBeTruthy();
		expect(view.getByText("escalated")).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /beta/ })),
		);
		const other = await waitFor(() => view.getByRole("dialog"));
		expect(other.textContent).toContain("1 of 3 tried");
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
			"arbor claim alpha picks it up",
		);
	});

	it("says in the dialog why a retry was refused", async () => {
		testing.refuseWrites = {
			reason: "usage",
			message: "'alpha' is working, not escalated",
		};
		const view = await testing.openTasks({
			tasks: [details({ status: "escalated", mergeAttempts: 3 })],
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
				"'alpha' is working, not escalated",
			),
		);
		expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("fills a bar with the steps its plan has checked off", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({
					task: "alpha",
					plan: "# alpha\n\n## Done\n\n- [x] one\n\n## Next\n\n- [ ] two\n- [ ] three\n- [ ] four\n",
				}),
			],
		});

		const bar = view.getByRole("progressbar", { name: "progress" });
		expect(bar.getAttribute("aria-valuenow")).toBe("1");
		expect(bar.getAttribute("aria-valuemax")).toBe("4");
		expect(view.getByText("1/4")).toBeTruthy();
	});
});
