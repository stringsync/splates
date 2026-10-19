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

	/** The untriaged cards, top first, as text. */
	const cards = (view: Awaited<ReturnType<Testing["open"]>>) =>
		within(view.getByRole("list", { name: "Untriaged tasks", hidden: true }))
			.getAllByRole("listitem", { hidden: true })
			.map((card) => card.textContent ?? "");

	it("badges each waiting card with its stage, and a queued one with its place", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "loose", position: 1 }),
				todo({
					id: 2,
					subject: "groomed",
					position: 2,
					stage: "ready",
					groomed: true,
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
				todo({
					id: 6,
					subject: "groomed, no agent",
					position: 6,
					stage: "ready",
					groomed: true,
				}),
			],
		});

		const cards = within(view.getByRole("list", { name: "Untriaged tasks" }))
			.getAllByRole("listitem")
			.map((card) => card.textContent ?? "");
		expect(cards[0]).toContain("Backlog");
		expect(cards[1]).toContain("Ready");
		expect(cards[1]).not.toContain("agent picked when it runs");
		expect(cards[2]).toContain("Queued · 1");
		expect(cards[3]).toContain("Queued · 2");
		expect(cards[4]).not.toMatch(/Backlog|Ready|Queue/);
		expect(cards[5]).toContain("Ready");
		expect(cards[5]).toContain("agent picked when it runs");
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

	it("queues and unqueues from the card, its dialog saying so at the click", async () => {
		const view = await testing.open({
			todos: [todo({ id: 1, subject: "retry the upload" })],
		});
		testing.holdWrites();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Queue #1" })),
		);

		expect(testing.posted("/api/todos/1/queued")).toEqual([
			{ method: "PUT", body: { queued: true } },
		]);
		expect(
			view.getByRole("img", {
				name: "Queued, 1 in line for an agent",
				hidden: true,
			}),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^retry the upload/ })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("Queued · 1");
		// The card queues it; its dialog only says where it stands.
		expect(within(dialog).queryByRole("button", { name: /queue/i })).toBeNull();

		await act(async () =>
			// On the card behind the dialog, which shows the change at once.
			fireEvent.click(view.getByLabelText("Unqueue #1")),
		);

		expect(testing.posted("/api/todos/1/queued").at(-1)).toEqual({
			method: "PUT",
			body: { queued: false },
		});
		expect(dialog.textContent).toContain("Backlog");
		expect(
			view.queryByRole("img", { name: /in line for an agent/, hidden: true }),
		).toBeNull();
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

	it("shows no queue column, only the board's lanes", async () => {
		const view = await testing.open({
			todos: [todo({ id: 1, subject: "first", position: 1, stage: "queued" })],
		});

		expect(view.queryByRole("region", { name: "Queue" })).toBeNull();
	});

	it("marks a queued card as waiting for an agent, in start order, a blocked one after its blocker", async () => {
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
				todo({
					id: 4,
					subject: "going",
					position: 4,
					stage: "running",
					takenBy: "beta",
				}),
			],
		});

		const marks = within(view.getByRole("list", { name: "Untriaged tasks" }))
			.getAllByRole("listitem")
			.map(
				(card) =>
					within(card)
						.queryByRole("img", { name: /in line for an agent/ })
						?.getAttribute("aria-label") ?? null,
			);
		expect(marks).toEqual([
			"Queued, 2 in line for an agent",
			"Queued, 1 in line for an agent",
			null,
			null,
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
			fireEvent.click(view.getByRole("button", { name: "Unqueue #1" })),
		);
		expect(cards(view)[0]).toContain("Backlog");

		testing.refuseWrites = {
			reason: "not_found",
			message: "task 1 is not in the queue",
		};
		await act(async () => testing.release());

		await waitFor(() => expect(cards(view)[0]).toContain("Queued · 1"));
		expect(view.getByRole("alert").textContent).toBe(
			"Not unqueued: task 1 is not in the queue",
		);
	});
});
