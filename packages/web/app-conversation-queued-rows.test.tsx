import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's queued rows in the sidebar", () => {
	let testing: Testing;

	const board = {
		todos: [
			todo({
				id: 1,
				subject: "Needs the third",
				blockedBy: [3],
				stage: "queued",
			}),
			todo({ id: 2, subject: "Waits for an agent", stage: "queued" }),
			todo({ id: 3, subject: "Not queued yet", stage: "available" }),
		],
		lanes: [],
	};

	beforeEach(() => {
		localStorage.clear();
		testing = new Testing();
		testing.everywhere = [
			{
				project: "wren",
				repo: "wren",
				root: "/repo",
				trunk: "main",
				tasks: [],
				laneNames: [],
				worktreeRoot: "/code/worktrees",
				lanesTaken: {},
				conversations: [],
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("lists queued tasks under the agents, the blocked after those starting next", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			undefined,
			board,
		);
		const queue = await waitFor(() =>
			view.getByRole("list", { name: /queue$/ }),
		);
		const rows = within(queue).getAllByRole("listitem");

		expect(rows.map((row) => row.textContent)).toEqual([
			"Waits for an agentWaiting for an agent · 1 in line",
			"Needs the thirdWaiting on blockers · #3",
		]);
		expect(queue.querySelectorAll(".lucide-hourglass")).toHaveLength(2);
		expect(queue.querySelector(".lucide-ban")).toBeNull();
		expect(within(queue).queryByText("Not queued yet")).toBeNull();
	});

	it("applies the row highlight on the list item so it covers trailing action buttons", async () => {
		const view = await testing.openConversations([], undefined, board);
		const queue = await waitFor(() =>
			view.getByRole("list", { name: /queue$/ }),
		);
		const [row] = within(queue).getAllByRole("listitem");
		if (row === undefined) {
			throw new Error("expected a queued row");
		}
		const rowButton = row.querySelector("button[data-row]");

		expect(row.className).toContain("rounded-md");
		expect(row.className).toContain("hover:bg-foreground/[0.05]");
		expect(row.className).toContain("active:bg-foreground/[0.08]");
		expect(rowButton?.className).not.toContain("hover:bg-foreground/[0.05]");
		expect(rowButton?.className).not.toContain("active:bg-foreground/[0.08]");
	});

	it("names queued and running dependencies instead of waiting for an agent", async () => {
		const view = await testing.openConversations([], undefined, {
			todos: [
				todo({
					id: 1,
					subject: "After running",
					stage: "queued",
					blockedBy: [3],
				}),
				todo({
					id: 2,
					subject: "After queued",
					stage: "queued",
					blockedBy: [1],
				}),
				todo({
					id: 3,
					subject: "Running",
					stage: "running",
					takenBy: "upstream",
				}),
			],
			lanes: [],
		});
		const queue = await view.findByRole("list", { name: /queue$/ });
		expect(within(queue).getByText("Waiting on blockers · #3")).toBeTruthy();
		expect(within(queue).getByText("Waiting on blockers · #1")).toBeTruthy();
		expect(within(queue).queryByText(/Waiting for an agent/)).toBeNull();
	});

	it("unqueues directly from a queued row without opening its page", async () => {
		const view = await testing.openConversations([], undefined, board);
		fireEvent.click(await view.findByRole("button", { name: "Unqueue #2" }));
		await waitFor(() =>
			expect(testing.posted("/api/todos/2/queued")).toEqual([
				{ method: "PUT", body: { queued: false } },
			]),
		);
	});

	it("shows a queued row's Unqueue as busy, and disabled, until the server answers", async () => {
		const view = await testing.openConversations([], undefined, board);
		const button = await view.findByRole("button", { name: "Unqueue #2" });
		fireEvent.click(button);
		await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
		expect((button as HTMLButtonElement).disabled).toBe(true);
	});

	it("opens a queued task on its own page, which puts it back on the board", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			undefined,
			board,
		);
		const queue = await waitFor(() =>
			view.getByRole("list", { name: /queue$/ }),
		);
		fireEvent.click(within(queue).getByText("Waits for an agent"));
		await waitFor(() => view.getByRole("article", { name: "Task #2" }));
		fireEvent.click(view.getByRole("button", { name: "Unqueue: Unqueue" }));
		await waitFor(() =>
			expect(testing.posted("/api/todos/2/queued")).toEqual([
				{ method: "PUT", body: { queued: false } },
			]),
		);
	});

	it("queues a blocked task's blockers from the row's triangle", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			undefined,
			board,
		);
		const queue = await waitFor(() =>
			view.getByRole("list", { name: /queue$/ }),
		);
		fireEvent.click(
			await within(queue).findByRole("button", {
				name: "Queue 1 blocker of Needs the third",
			}),
		);
		expect(
			within(queue).queryByRole("button", {
				name: "Queue 1 blocker of Waits for an agent",
			}),
		).toBeNull();
		await waitFor(() =>
			expect(testing.posted("/api/todos/3/queued")).toEqual([
				{ method: "PUT", body: { queued: true } },
			]),
		);
	});

	it("offers the same on the blocked task's page", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			undefined,
			board,
		);
		const queue = await waitFor(() =>
			view.getByRole("list", { name: /queue$/ }),
		);
		fireEvent.click(within(queue).getByText("Needs the third"));
		fireEvent.click(
			await view.findByRole("button", { name: "Queue 1 blocker" }),
		);
		await waitFor(() =>
			expect(testing.posted("/api/todos/3/queued")).toEqual([
				{ method: "PUT", body: { queued: true } },
			]),
		);
	});

	it("shows a queue error inline on unblocked rows while leaving blocked rows untouched", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Fix login" })],
			undefined,
			{
				...board,
				queueError: "auto-pick.json is invalid",
			},
		);
		const queue = await waitFor(() =>
			view.getByRole("list", { name: /queue$/ }),
		);
		const rows = within(queue).getAllByRole("listitem");

		expect(rows.map((row) => row.textContent)).toEqual([
			"Waits for an agentQueue error: auto-pick.json is invalid",
			"Needs the thirdWaiting on blockers · #3",
		]);
		expect(queue.querySelectorAll(".lucide-circle-alert")).toHaveLength(1);
		expect(queue.querySelectorAll(".lucide-hourglass")).toHaveLength(1);
		expect(within(queue).queryByText(/Waiting for an agent/)).toBeNull();
	});

	it("shows a queue error inline on unblocked cards on the Queue page", async () => {
		const view = await testing.openTasks({
			...board,
			queueError: "auto-pick.json is invalid",
		});
		const queued = await waitFor(() =>
			view.getByRole("list", { name: "queued tasks" }),
		);
		expect(within(queued).getByRole("alert").textContent).toBe(
			"Queue error: auto-pick.json is invalid",
		);
		const blocked = view.getByRole("list", { name: "blocked tasks" });
		expect(within(blocked).queryByRole("alert")).toBeNull();
	});

	it("highlights conversations holding blockers when hovering or selecting a blocked queued row", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", task: "upstream", title: "Upstream fix" }),
				conversation({ id: "c2", task: "other", title: "Unrelated work" }),
			],
			undefined,
			{
				todos: [
					todo({
						id: 12,
						subject: "Upstream fix",
						stage: "running",
						takenBy: "upstream",
					}),
					todo({
						id: 18,
						subject: "Blocked task",
						stage: "queued",
						blockedBy: [12],
					}),
					todo({
						id: 19,
						subject: "Chained task",
						stage: "queued",
						blockedBy: [18],
					}),
				],
				lanes: [],
			},
		);
		const queue = await view.findByRole("list", { name: /queue$/ });
		const blockedLi = within(queue)
			.getByText("Blocked task")
			.closest("li") as HTMLLIElement;
		const chainedLi = within(queue)
			.getByText("Chained task")
			.closest("li") as HTMLLIElement;
		const upstreamRow = view
			.getByText("Upstream fix")
			.closest("[data-blocker-id], div") as HTMLElement;
		const unrelatedRow = view.getByText("Unrelated work").closest("button")
			?.parentElement as HTMLElement;

		// Hovering Blocked task marks the conversation holding #12 with a softer dependency pill and no row tint.
		fireEvent.mouseEnter(blockedLi);
		expect(upstreamRow.getAttribute("data-blocker-id")).toBe("12");
		expect(upstreamRow.className).not.toContain("blocker-wash");
		const blockerPill = within(upstreamRow).getByText("#12");
		const sourcePill = within(blockedLi).getByText("#12");
		expect(sourcePill.className).toContain("bg-(--blocker-pill-bg)");
		expect(sourcePill.className).toContain("text-(--blocker-pill-fg)");
		expect(blockerPill.className).toContain("bg-(--blocker-pill-subtle-bg)");
		expect(blockerPill.className).toContain("text-(--blocker-pill-subtle-fg)");
		expect(unrelatedRow.getAttribute("data-blocker-id")).toBeNull();

		// Leaving clears the hover highlight while another conversation is open.
		fireEvent.mouseLeave(blockedLi);
		expect(upstreamRow.getAttribute("data-blocker-id")).toBeNull();
		expect(within(upstreamRow).queryByText("#12")).toBeNull();

		// Selecting Blocked task keeps #12 highlighted even when hovering an unrelated row.
		fireEvent.click(
			within(blockedLi).getByRole("button", { name: /Blocked task/ }),
		);
		await waitFor(() =>
			expect(
				within(blockedLi)
					.getByRole("button", { name: /Blocked task/ })
					.getAttribute("aria-current"),
			).toBe("page"),
		);
		expect(upstreamRow.getAttribute("data-blocker-id")).toBe("12");
		fireEvent.mouseEnter(unrelatedRow);
		expect(upstreamRow.getAttribute("data-blocker-id")).toBe("12");

		// Hovering Chained task switches the highlight to the queued row holding #18 with the subtle pill.
		fireEvent.mouseEnter(chainedLi);
		expect(blockedLi.getAttribute("data-blocker-id")).toBe("18");
		const queuedBlockerPill = within(blockedLi).getByText("#18");
		expect(queuedBlockerPill.className).toContain(
			"bg-(--blocker-pill-subtle-bg)",
		);
		expect(queuedBlockerPill.className).toContain(
			"text-(--blocker-pill-subtle-fg)",
		);
		expect(upstreamRow.getAttribute("data-blocker-id")).toBeNull();
	});
});
