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
		fireEvent.click(view.getByRole("button", { name: /Unqueue/ }));
		await waitFor(() =>
			expect(testing.posted("/api/todos/2/queued")).toEqual([
				{ method: "PUT", body: { queued: false } },
			]),
		);
	});
});
