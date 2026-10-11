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
