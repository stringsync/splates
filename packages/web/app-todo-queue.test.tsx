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

describe("App's queue", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/**
	 * The queue column, under a dialog too, where a hidden region has no
	 * accessible name to find it by.
	 */
	const column = (view: Awaited<ReturnType<Testing["open"]>>) => {
		const found = view
			.getAllByRole("region", { hidden: true })
			.find((region) => region.getAttribute("aria-label") === "Queue");
		if (found === undefined) {
			throw new Error("no queue column");
		}
		return found;
	};

	/** The queue column's rows, next to start first. */
	const queued = (view: Awaited<ReturnType<Testing["open"]>>) =>
		within(column(view))
			.queryAllByRole("listitem", { hidden: true })
			.map((row) => row.textContent ?? "");

	it("badges each waiting card with its stage, and a queued one with its place", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "loose", position: 1 }),
				todo({
					id: 2,
					subject: "groomed",
					position: 2,
					stage: "ready",
					assignee: { agent: "claude" },
				}),
				todo({ id: 3, subject: "first up", position: 3, stage: "queued" }),
				todo({ id: 4, subject: "second up", position: 4, stage: "queued" }),
				todo({
					id: 5,
					subject: "going",
					position: 5,
					stage: "running",
					takenBy: "beta",
				}),
			],
		});

		const cards = within(view.getByRole("list", { name: "Untriaged todos" }))
			.getAllByRole("listitem")
			.map((card) => card.textContent ?? "");
		expect(cards[0]).toContain("Backlog");
		expect(cards[1]).toContain("Ready");
		expect(cards[2]).toContain("Queued · 1");
		expect(cards[3]).toContain("Queued · 2");
		expect(cards[4]).toContain("beta");
		expect(cards[4]).not.toMatch(/Backlog|Ready|Queue/);
	});

	it("counts a lane's todos by stage in its header, leaving out the stages it has none in", async () => {
		const view = await testing.open({
			todos: [
				todo({
					id: 1,
					position: 1,
					lane: 1,
					takenBy: "beta",
					stage: "running",
				}),
				todo({ id: 2, position: 2, lane: 1, stage: "queued" }),
				todo({ id: 3, position: 3, lane: 1, stage: "queued" }),
				todo({ id: 4, position: 4, lane: 1 }),
				todo({ id: 5, position: 5, lane: 1 }),
				todo({ id: 6, position: 6, lane: 1 }),
			],
			lanes: [{ id: 1, name: "Licensing" }],
		});

		const header = view
			.getByRole("region", { name: "Licensing" })
			.querySelector("header");
		expect(header?.textContent).toContain("1 running · 2 queued · 3 backlog");
		expect(header?.textContent).not.toContain("ready");
	});

	it("queues and unqueues from the dialog, showing it at the click", async () => {
		const view = await testing.open({
			todos: [todo({ id: 1, subject: "retry the upload" })],
		});
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^retry the upload/ })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Queue" })),
		);

		expect(testing.posted("/api/todos/1/queued")).toEqual([
			{ method: "PUT", body: { queued: true } },
		]);
		expect(dialog.textContent).toContain("Queued · 1");
		expect(queued(view)).toEqual([expect.stringContaining("retry the upload")]);

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Unqueue" })),
		);

		expect(testing.posted("/api/todos/1/queued").at(-1)).toEqual({
			method: "PUT",
			body: { queued: false },
		});
		expect(dialog.textContent).toContain("Backlog");
		expect(queued(view)).toEqual([]);
		expect(column(view).textContent).toContain(
			"starts on a worker once nothing blocks it",
		);
	});

	it("offers neither in the dialog of a todo under way", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "going", takenBy: "beta", stage: "running" }),
			],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^going/ })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).queryByRole("button", { name: /queue/i })).toBeNull();
	});

	it("lists the queue in start order, a blocked todo after its blocker, saying what it waits on", async () => {
		const view = await testing.open({
			todos: [
				todo({
					id: 1,
					subject: "blocked",
					position: 1,
					stage: "queued",
					blockedBy: [2],
				}),
				todo({ id: 2, subject: "blocker", position: 2, stage: "queued" }),
				todo({ id: 3, subject: "loose", position: 3 }),
			],
		});

		expect(queued(view)).toEqual([
			expect.stringContaining("#2blocker"),
			expect.stringContaining("#1blocked"),
		]);
		expect(queued(view)[1]).toContain("waits on #2");
		expect(queued(view)[0]).not.toContain("waits on");
	});

	it("moves a todo up the queue at once, sending its new place", async () => {
		const view = await testing.open({
			todos: [1, 2, 3].map((id) =>
				todo({ id, subject: `task ${id}`, position: id, stage: "queued" }),
			),
		});
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Move #3 up" })),
		);

		expect(testing.posted("/api/todos/3/queue-position")).toEqual([
			{ method: "PUT", body: { position: 2 } },
		]);
		expect(queued(view)).toEqual([
			expect.stringContaining("task 1"),
			expect.stringContaining("task 3"),
			expect.stringContaining("task 2"),
		]);
		expect(
			(view.getByRole("button", { name: "Move #1 up" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("moves a todo down by moving the one below it up, which the server places exactly", async () => {
		const view = await testing.open({
			todos: [1, 2, 3].map((id) =>
				todo({ id, subject: `task ${id}`, position: id, stage: "queued" }),
			),
		});
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Move #1 down" })),
		);

		expect(testing.posted("/api/todos/1/queue-position")).toEqual([
			{ method: "PUT", body: { position: 2 } },
		]);
		expect(queued(view)).toEqual([
			expect.stringContaining("task 2"),
			expect.stringContaining("task 1"),
			expect.stringContaining("task 3"),
		]);
	});

	it("puts an unqueued todo back when the server refuses, saying why", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first", position: 1, stage: "queued" }),
				todo({ id: 2, subject: "second", position: 2, stage: "queued" }),
			],
		});
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(
				within(column(view)).getByRole("button", { name: "Unqueue #1" }),
			),
		);
		expect(queued(view)).toEqual([expect.stringContaining("second")]);

		testing.refuseWrites = {
			reason: "not_found",
			message: "task 1 is not in the queue",
		};
		await act(async () => testing.release());

		await waitFor(() => expect(queued(view)).toHaveLength(2));
		expect(within(column(view)).getByRole("alert").textContent).toBe(
			"Not unqueued: task 1 is not in the queue",
		);
	});
});
