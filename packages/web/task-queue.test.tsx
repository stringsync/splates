import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
	fireEvent,
	openQueueRow,
	queueRow,
	snapshot,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("Queue page's Up next", () => {
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

		const next = view.getByRole("region", { name: "Up next" });
		expect(within(next).getByText("Nothing queued")).toBeTruthy();
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

		expect(names(view)).toEqual(["first", "second"]);
		expect(
			within(queueRow(view, "first", "queued tasks")).getAllByText("#3"),
		).not.toHaveLength(0);
		expect(view.queryByText("Nothing queued")).toBeNull();
	});

	it("holds the tasks at work and what waits next in one card", async () => {
		const view = await testing.openTasks({
			tasks: [details({ task: "at-work" })],
			todos: [todo({ id: 3, subject: "first", stage: "queued" })],
		});

		const queue = view.getByRole("region", { name: "queue card" });
		const yours = within(queue).getByRole("region", { name: "Started by you" });
		expect(within(yours).getByText("at-work")).toBeTruthy();
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

		await openQueueRow(view, "first", "queued tasks");

		await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
		expect(location.hash).toBe("");
	});

	const queue = () => [
		todo({ id: 3, subject: "first", stage: "queued", position: 1 }),
		todo({ id: 2, subject: "second", stage: "queued", position: 2 }),
	];
	/** Chooses `item` from the menu on queued task `name`'s row. */
	const choose = async (
		view: Awaited<ReturnType<Testing["openTasks"]>>,
		name: string,
		item: string,
	) => {
		await act(async () =>
			fireEvent.click(
				within(queueRow(view, name, "queued tasks")).getByRole("button", {
					name: "More actions",
				}),
			),
		);
		const entry = await waitFor(() =>
			view.getByRole("menuitem", { name: item }),
		);
		await act(async () => fireEvent.click(entry));
	};

	it("moves a task down the line at once", async () => {
		const view = await testing.openTasks({ todos: queue() });
		testing.holdWrites();

		const grip = within(queueRow(view, "first", "queued tasks")).getByRole(
			"button",
			{ name: "Drag to reorder" },
		);
		// happy-dom lays nothing out, so each row is given its place in the list.
		const [one, two] = within(
			view.getByRole("list", { name: "queued tasks" }),
		).getAllByRole("listitem") as [HTMLElement, HTMLElement];
		one.getBoundingClientRect = () => new DOMRect(0, 0, 600, 40);
		two.getBoundingClientRect = () => new DOMRect(0, 40, 600, 40);
		grip.focus();
		await act(async () => fireEvent.keyDown(grip, { code: "Space" }));
		await act(async () => fireEvent.keyDown(grip, { code: "ArrowDown" }));
		await act(async () => fireEvent.keyDown(grip, { code: "Space" }));

		expect(testing.posted("/api/todos/3/queue-position")).toEqual([
			{ method: "PUT", body: { position: 2 } },
		]);
		expect(names(view)).toEqual(["second", "first"]);
	});

	it("holds a task in the queue, pending, until the server takes it out", async () => {
		const view = await testing.openTasks({ todos: queue() });
		testing.holdWrites();

		await choose(view, "first", "Take out of queue");

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

	it("removes a task, and puts it back with Undo", async () => {
		const view = await testing.openTasks({ todos: queue() });

		await choose(view, "first", "Remove");

		// Undo is offered only once the removal has landed.
		await waitFor(() =>
			expect(view.getByText("Removed #3 first")).toBeTruthy(),
		);
		expect(
			(view.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);

		await serve({ todos: queue().filter((each) => each.id !== 3) });

		await waitFor(() =>
			expect(
				(view.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
					.disabled,
			).toBe(false),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Undo" })),
		);
		expect(testing.posted("/api/todos/3/restore")).toHaveLength(1);
		expect(view.queryByText("Removed #3 first")).toBeNull();
	});

	/** The names of the queued tasks, in the order Up next lists them. */
	const names = (view: Awaited<ReturnType<Testing["openTasks"]>>) =>
		within(view.getByRole("list", { name: "queued tasks" }))
			.getAllByRole("listitem")
			.map((row) => row.querySelector(".truncate")?.textContent);
});
