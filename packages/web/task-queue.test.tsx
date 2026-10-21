import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("Tasks page's queue", () => {
	let testing: Testing;

	beforeEach(() => {
		localStorage.clear();
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows the queue with nothing in it", async () => {
		const view = await testing.openTasks({ tasks: [], todos: [] });

		const queue = view.getByRole("region", { name: "queue" });
		expect(within(queue).getByText("Nothing queued")).toBeTruthy();
	});

	it("lists the queued tasks no agent has taken, in the order workers start them", async () => {
		const view = await testing.openTasks({
			todos: [
				todo({ id: 1, subject: "waiting", stage: "ready", position: 0 }),
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

		const queued = within(view.getByRole("list", { name: "queued tasks" }))
			.getAllByRole("listitem")
			.map((row) => row.textContent);
		expect(queued).toEqual(["1first#3", "2second#2"]);
		expect(view.queryByText("Nothing queued")).toBeNull();
	});

	it("holds the tasks at work and what waits next in one card", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "at-work" })],
			todos: [todo({ id: 3, subject: "first", stage: "queued" })],
		});

		const queue = view.getByRole("region", { name: "queue" });
		const working = within(queue).getByRole("region", { name: "Working" });
		expect(within(working).getByText("at-work")).toBeTruthy();
		const next = within(queue).getByRole("region", { name: "Up next" });
		expect(within(next).getByText("first")).toBeTruthy();
		expect(view.queryByRole("region", { name: "in progress" })).toBeNull();
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

		const rows = within(view.getByRole("list", { name: "queued tasks" }))
			.getAllByRole("listitem")
			.map((row) => row.textContent);
		expect(rows).toEqual(["1firstWaiting: 2h#3"]);
	});

	it("opens a queued task's card on the board", async () => {
		const view = await testing.openTasks({
			todos: [todo({ id: 3, subject: "first", stage: "queued" })],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /first/ })),
		);

		await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
		expect(location.hash).toBe("");
	});

	const queue = () => [
		todo({ id: 3, subject: "first", stage: "queued", position: 1 }),
		todo({ id: 2, subject: "second", stage: "queued", position: 2 }),
	];
	const choose = async (
		view: Awaited<ReturnType<Testing["openTasks"]>>,
		actions: string,
		item: string,
	) => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: actions })),
		);
		const entry = await waitFor(() =>
			view.getByRole("menuitem", { name: item }),
		);
		await act(async () => fireEvent.click(entry));
	};

	it("moves a task down the line at once", async () => {
		const view = await testing.openTasks({ todos: queue() });
		testing.holdWrites();

		await choose(view, "#3 actions", "Move down");

		expect(testing.posted("/api/todos/3/queue-position")).toEqual([
			{ method: "PUT", body: { position: 2 } },
		]);
		const rows = within(view.getByRole("list", { name: "queued tasks" }))
			.getAllByRole("listitem")
			.map((row) => row.textContent);
		expect(rows).toEqual(["1second#2", "2first#3"]);
	});

	it("takes a task out of the queue", async () => {
		const view = await testing.openTasks({ todos: queue() });

		await choose(view, "#3 actions", "Take out of queue");

		expect(testing.posted("/api/todos/3/queued")).toEqual([
			{ method: "PUT", body: { queued: false } },
		]);
		expect(view.queryByText("first")).toBeNull();
	});

	it("tags a manual task and switches it", async () => {
		const view = await testing.openTasks({
			todos: [todo({ id: 3, subject: "first", stage: "queued", manual: true })],
		});
		expect(view.getByText("manual")).toBeTruthy();

		await choose(view, "#3 actions", "Let lanes queue it");

		expect(testing.posted("/api/todos/3/manual")).toEqual([
			{ method: "PUT", body: { manual: false } },
		]);
		expect(view.queryByText("manual")).toBeNull();
	});

	it("removes a task, and puts it back with Undo", async () => {
		const view = await testing.openTasks({ todos: queue() });

		await choose(view, "#3 actions", "Remove");

		expect(view.getByText("Removed #3 first")).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Undo" })),
		);
		expect(testing.posted("/api/todos/3/restore")).toHaveLength(1);
		expect(view.queryByText("Removed #3 first")).toBeNull();
	});
});
