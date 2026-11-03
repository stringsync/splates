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
			"Needs the thirdBlocked · waits on #3",
		]);
		expect(within(queue).queryByText("Not queued yet")).toBeNull();
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
		expect(within(queue).getByText("Blocked · waits on #3")).toBeTruthy();
		expect(within(queue).getByText("Blocked · waits on #1")).toBeTruthy();
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
		await waitFor(() => view.getByText("Queued · 1"));
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
});
