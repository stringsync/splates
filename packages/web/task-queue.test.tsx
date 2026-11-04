import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
	fireEvent,
	queueRow,
	snapshot,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("Queue page's Queued and Blocked columns", () => {
	let testing: Testing;

	beforeEach(() => {
		localStorage.clear();
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The server lists `overrides` as the board, as it does once a write lands. */
	async function serve(
		overrides: Parameters<typeof snapshot>[0],
	): Promise<void> {
		testing.served = snapshot(overrides);
		await act(async () => testing.stream?.onmessage?.());
	}

	it("shows the queue with nothing in it", async () => {
		const view = await testing.openTasks({ tasks: [], todos: [] });

		const next = view.getByRole("region", { name: "Queued" });
		expect(within(next).getByText("Nothing queued")).toBeTruthy();
	});

	it("lists the queued tasks no agent has taken, in the order workers start them", async () => {
		const view = await testing.openTasks({
			todos: [
				todo({ id: 1, subject: "waiting", stage: "available", position: 0 }),
				todo({ id: 2, subject: "second", stage: "queued", position: 2 }),
				todo({ id: 3, subject: "first", stage: "queued", position: 1 }),
				todo({
					id: 4,
					subject: "running",
					stage: "queued",
					position: 0,
					takenBy: "someone",
				}),
			],
		});

		expect(names(view)).toEqual(["first", "second"]);
		expect(
			within(queueRow(view, "first", "queued tasks")).getAllByText("#3"),
		).not.toHaveLength(0);
		expect(view.queryByText("Nothing queued")).toBeNull();
	});

	it("lists blocked tasks under Blocked, not Queued, and queues one's blockers from its card", async () => {
		const view = await testing.openTasks({
			todos: [
				todo({ id: 1, subject: "store licenses", stage: "available" }),
				todo({ id: 2, subject: "check them", stage: "queued", blockedBy: [1] }),
				todo({ id: 3, subject: "free", stage: "queued" }),
			],
		});

		expect(names(view)).toEqual(["free"]);
		const blocked = view.getByRole("region", { name: "Blocked" });
		expect(within(blocked).getAllByText("check them")).not.toHaveLength(0);
		expect(within(blocked).getAllByText("needs #1 queued")).not.toHaveLength(0);

		await act(async () =>
			fireEvent.click(
				within(blocked).getAllByRole("button", {
					name: "Queue 1 blocker",
				})[0] as HTMLElement,
			),
		);
		await serve({
			todos: [
				todo({ id: 1, subject: "store licenses", stage: "queued" }),
				todo({ id: 2, subject: "check them", stage: "queued", blockedBy: [1] }),
				todo({ id: 3, subject: "free", stage: "queued" }),
			],
		});

		await waitFor(() =>
			expect(within(blocked).getByText("Queued #1 for #2")).toBeTruthy(),
		);
		expect(testing.posted("/api/todos/1/queued")).toEqual([
			{ method: "PUT", body: { queued: true } },
		]);
		expect(names(view)).toEqual(["store licenses", "check them", "free"]);
	});

	it("shows the tasks at work and what waits next in their own columns", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "at-work" })],
			todos: [todo({ id: 3, subject: "first", stage: "queued" })],
		});

		const running = view.getByRole("region", { name: "Running" });
		expect(within(running).getByText("at-work")).toBeTruthy();
		const next = view.getByRole("region", { name: "Queued" });
		expect(within(next).getByText("first")).toBeTruthy();
	});

	it("says how long each queued task has waited", async () => {
		const view = await testing.openTasks({
			todos: [
				todo({
					id: 3,
					subject: "first",
					stage: "queued",
					queuedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
				}),
			],
		});

		const row = queueRow(view, "first", "queued tasks");
		expect(
			within(row)
				.getAllByTitle("How long it has waited in the queue")
				.map((age) => age.textContent),
		).toContain("Waiting: 2h");
	});

	it("opens a queued task's card on the board", async () => {
		const view = await testing.openTasks({
			todos: [todo({ id: 3, subject: "first", stage: "queued" })],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "first" })),
		);

		await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
		expect(location.hash).toBe("#todos");
	});

	const queue = () => [
		todo({ id: 3, subject: "first", stage: "queued", position: 1 }),
		todo({ id: 2, subject: "second", stage: "queued", position: 2 }),
	];
	it("draws no grip, so no card on the Queue board can be moved", async () => {
		const view = await testing.openTasks({
			todos: [
				...queue(),
				todo({
					id: 4,
					subject: "held",
					stage: "queued",
					position: 3,
					blockedBy: [9],
				}),
				todo({ id: 9, subject: "blocker" }),
			],
		});

		expect(view.getByRole("list", { name: "queued tasks" })).toBeTruthy();
		expect(view.getByRole("list", { name: "blocked tasks" })).toBeTruthy();
		expect(view.queryByRole("button", { name: /^move / })).toBeNull();
		expect(view.queryByRole("button", { name: "Drag to reorder" })).toBeNull();
	});

	it("reads Blocked, Queued, Running, Done, with each column and the board locked", async () => {
		const view = await testing.openTasks({ todos: queue() });

		expect(
			view
				.getAllByRole("heading", { level: 3 })
				.map((heading) => heading.firstChild?.textContent),
		).toEqual(["Blocked", "Queued", "Running", "Done"]);
		expect(view.getAllByLabelText(/^Permanent column: /).length).toBe(4);
		expect(view.getByLabelText(/^Permanent board: /)).toBeTruthy();
	});

	it("holds a task in the queue, pending, until the server takes it out", async () => {
		const view = await testing.openTasks({ todos: queue() });
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Unqueue #3" })),
		);

		expect(testing.posted("/api/todos/3/queued")).toEqual([
			{ method: "PUT", body: { queued: false } },
		]);
		expect(
			queueRow(view, "first", "queued tasks")
				.querySelector("[aria-busy]")
				?.getAttribute("aria-busy"),
		).toBe("true");

		expect(view.getByText("first")).toBeTruthy();

		await act(async () => testing.release());
		await serve({ todos: queue().filter((each) => each.id !== 3) });

		await waitFor(() => expect(view.queryByText("first")).toBeNull());
	});

	it("names a card's lane on a chip that opens the lane", async () => {
		const view = await testing.openTasks({
			lanes: [{ id: 5, name: "Providers" }],
			todos: [todo({ id: 3, subject: "first", stage: "queued", lane: 5 })],
		});

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Open lane Providers" }),
			),
		);

		await waitFor(() => expect(location.hash).toBe("#lanes/5"));
	});

	/** The names of the queued tasks, in the order Queued lists them. */
	const names = (view: Awaited<ReturnType<Testing["openTasks"]>>) =>
		within(view.getByRole("list", { name: "queued tasks" }))
			.getAllByRole("listitem")
			.map((row) => row.querySelector("button")?.textContent);
});
