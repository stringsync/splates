import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
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

	it("keeps a task an agent took in view, with where it came from", async () => {
		const view = await testing.openTasks({
			todos: [
				todo({
					id: 4,
					subject: "running",
					stage: "queued",
					takenBy: "someone",
					from: "other-task",
				}),
				todo({ id: 5, subject: "lane run", takenBy: "x", lane: 2 }),
				todo({
					id: 6,
					subject: "by lane",
					takenBy: "y",
					queuedBy: { by: "lane", lane: 3 },
				}),
				todo({
					id: 7,
					subject: "by person",
					takenBy: "z",
					queuedBy: { by: "person" },
				}),
			],
		});

		const running = within(view.getByRole("list", { name: "running tasks" }))
			.getAllByRole("listitem")
			.map((row) => row.textContent);
		expect(running).toEqual([
			"runningfrom other-task#4",
			"lane runlane 2#5",
			"by lanequeued by lane 3#6",
			"by personqueued by you#7",
		]);
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
});
