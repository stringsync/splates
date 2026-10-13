import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
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
					status: "escalated",
					escalation: "needs eyes",
					plan: "# beta\n\n## Goal\n\nship the thing\n",
				}),
			],
		});

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

	it("shows only the conversations on a task in its row, not where it stands", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({
					task: "alpha",
					status: "escalated",
					review: "drag a todo",
					plan: "# alpha\n\n## Done\n\n- [x] one\n\n## Next\n\n- [ ] two\n",
				}),
			],
		});

		const row = view.getByRole("button", { name: /alpha/ });
		expect(row.textContent).toBe("alpha");
		expect(view.queryByRole("progressbar")).toBeNull();
	});

	const BLOCKED = `# beta

## Goal

ship the thing

## Notes

see the header

## Blocked

- [x] 1. Do the tests pass? → yes
- [ ] 2. How should sessions move?
  Sessions are keyed by the old cookie.
  - (a) Sign everyone out once
  - (b) Migrate each on its next request (chosen)
`;

	const escalated = details({
		task: "beta",
		status: "escalated",
		escalation: "needs a call",
		plan: BLOCKED,
	});

	const openBeta = async (view: Awaited<ReturnType<Testing["open"]>>) => {
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("list", { name: "task list" })).getByRole(
					"button",
					{ name: /beta/ },
				),
			),
		);
		return await waitFor(() => view.getByRole("dialog"));
	};

	it("shows a task's whole plan, Blocked and all, each question's number beside its box", async () => {
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);

		expect(dialog.textContent).toContain("see the header");
		expect(
			within(dialog).getByRole("heading", { name: "Blocked" }),
		).toBeTruthy();
		const item = within(dialog).getByText(/2\. How should sessions move\?/);
		expect(
			item.closest("li")?.querySelector("input[type=checkbox]"),
		).toBeTruthy();
		expect(
			within(dialog).queryByRole("list", { name: "questions" }),
		).toBeNull();
	});

	it("answers a task's open questions from its action bar in the dialog when the page runs no conversations", async () => {
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);

		await act(async () =>
			fireEvent.click(
				within(
					within(dialog).getByRole("toolbar", { name: "actions" }),
				).getByRole("button", { name: "Answer a question" }),
			),
		);

		expect(
			within(dialog).getByRole("region", { name: "questions for you" }),
		).toBeTruthy();
		expect(
			within(dialog).getByRole("button", { name: /Sign everyone out once/ }),
		).toBeTruthy();
	});

	it("goes from a task's open questions to its external agent's view to answer them", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.openTasks({ tasks: [escalated] });
		const dialog = await openBeta(view);

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Answer a question" }),
			),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(location.hash).toBe("#conversations/task/beta");
		expect(
			within(view.getByRole("region", { name: "beta" })).getByRole("region", {
				name: "questions for you",
			}),
		).toBeTruthy();
	});

	it("keeps the open task in the address, and opens the one it names", async () => {
		const view = await testing.openTasks({ tasks: [escalated] });
		await openBeta(view);
		expect(location.hash).toBe("#tasks/beta");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Close" })),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(location.hash).toBe("#tasks");

		await act(async () => {
			location.hash = "#tasks/beta";
		});
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByRole("heading", { name: "beta" })).toBeTruthy();
	});

	it("offers no changes to review for a task with no commits", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.openTasks({
			tasks: [details({ task: "beta", ahead: 0, added: 0, removed: 0 })],
		});
		const dialog = await openBeta(view);

		expect(dialog.textContent).toContain("0 commits");
		expect(within(dialog).queryByText("Review changes")).toBeNull();
	});
});
