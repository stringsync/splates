import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
	fireEvent,
	snapshot,
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

	/** The server lists `overrides` as the board, as it does once a write lands. */
	async function serve(
		overrides: Parameters<typeof snapshot>[0],
	): Promise<void> {
		testing.served = snapshot(overrides);
		await act(async () => testing.stream?.onmessage?.());
	}

	/** The Backlog cards, top first, as text. */
	const _cards = (view: Awaited<ReturnType<Testing["open"]>>) =>
		within(view.getByRole("list", { name: "Backlog tasks", hidden: true }))
			.getAllByRole("listitem", { hidden: true })
			.map((card) => card.textContent ?? "");

	it("strips each queued or running card in a color, and leaves a waiting one plain", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "loose", position: 1 }),
				todo({
					id: 2,
					subject: "groomed",
					position: 2,
					stage: "available",
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
					stage: "available",
				}),
			],
			tasks: [details({ task: "beta" })],
		});

		const cards = within(view.getByRole("list", { name: "Backlog tasks" }))
			.getAllByRole("listitem")
			.map((card) => card.textContent ?? "");
		const badges = within(view.getByRole("list", { name: "Backlog tasks" }))
			.getAllByRole("listitem")
			.map(
				(card) =>
					card.querySelector("[data-status]")?.getAttribute("data-status") ??
					null,
			);
		// A waiting card has no badge, a queued one Queued, one under way Running.
		expect(badges).toEqual([null, null, "queued", "queued", "running", null]);
		expect(cards.join("")).not.toContain("Auto pick");
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
			tasks: [details({ task: "beta" })],
		});

		const header = view
			.getByRole("region", { name: "Licensing" })
			.querySelector("header");
		expect(header?.textContent).toContain("1 running · 2 queued · 3 available");
		expect(header?.textContent).not.toContain("ready");
	});

	it("marks a card pending while its own Queue is held, until the server lists it", async () => {
		const view = await testing.open({
			todos: [todo({ id: 1, subject: "retry the upload" })],
		});
		testing.holdWrites();
		const busy = () =>
			view
				.getByRole("button", { name: /^retry the upload/, hidden: true })
				.closest("[aria-busy]")
				?.getAttribute("aria-busy");
		expect(busy()).not.toBe("true");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Queue #1" })),
		);
		expect(busy()).toBe("true");

		await serve({
			todos: [todo({ id: 1, subject: "retry the upload", stage: "queued" })],
		});
		await act(async () => testing.release());
		await waitFor(() => expect(busy()).not.toBe("true"));
	});

	it("queues and unqueues from the card, held pending until the server lists it, its dialog saying so then", async () => {
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
		await serve({
			todos: [todo({ id: 1, subject: "retry the upload", stage: "queued" })],
		});
		await waitFor(() => expect(view.getByLabelText("Unqueue #1")).toBeTruthy());
		await act(async () => testing.release());
		testing.holdWrites();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^retry the upload/ })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("Queued · 1");
		// The card queues it; its dialog only says where it stands.
		expect(within(dialog).queryByRole("button", { name: /queue/i })).toBeNull();

		await act(async () =>
			// On the card behind the dialog.
			fireEvent.click(view.getByLabelText("Unqueue #1")),
		);

		expect(testing.posted("/api/todos/1/queued").at(-1)).toEqual({
			method: "PUT",
			body: { queued: false },
		});
		expect(dialog.textContent).toContain("Queued · 1");

		await serve({ todos: [todo({ id: 1, subject: "retry the upload" })] });

		await waitFor(() => expect(dialog.textContent).toContain("Available"));
	});

	it("queues a card blocked by tasks not queued as Blocked, its button queuing them at once with Undo", async () => {
		const board = (
			third: "available" | "queued",
			first: "available" | "queued",
			second: "available" | "queued",
		) => [
			todo({ id: 1, subject: "store licenses", stage: first }),
			todo({ id: 2, subject: "check them", stage: second, blockedBy: [1] }),
			todo({ id: 3, subject: "bill for them", stage: third, blockedBy: [2] }),
		];
		const view = await testing.open({
			todos: board("available", "available", "available"),
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Queue #3" })),
		);
		// No question asked: it goes in the queue as it is.
		expect(view.queryByRole("dialog")).toBeNull();
		expect(testing.posted("/api/todos/3/queued")).toEqual([
			{ method: "PUT", body: { queued: true } },
		]);
		await serve({ todos: board("queued", "available", "available") });

		const card = () =>
			view
				.getByRole("button", { name: /^bill for them/ })
				.closest("li") as HTMLElement;
		await waitFor(() =>
			expect(within(card()).getByText("Blocked")).toBeTruthy(),
		);

		await act(async () =>
			fireEvent.click(
				within(card()).getByRole("button", { name: "Queue 2 blockers" }),
			),
		);
		await serve({ todos: board("queued", "queued", "available") });
		await waitFor(() =>
			expect(testing.posted("/api/todos/2/queued")).toHaveLength(1),
		);
		await serve({ todos: board("queued", "queued", "queued") });

		await waitFor(() => expect(card().textContent).toContain("Queued #1, #2"));
		expect(testing.posted("/api/todos/1/queued")).toHaveLength(1);
		expect(testing.posted("/api/todos/2/queued")).toHaveLength(1);

		await act(async () =>
			fireEvent.click(within(card()).getByRole("button", { name: "Undo" })),
		);
		// Undo takes them back out, the last queued first.
		await waitFor(() =>
			expect(testing.posted("/api/todos/2/queued").at(-1)).toEqual({
				method: "PUT",
				body: { queued: false },
			}),
		);
		await serve({ todos: board("queued", "queued", "available") });
		await waitFor(() =>
			expect(testing.posted("/api/todos/1/queued").at(-1)).toEqual({
				method: "PUT",
				body: { queued: false },
			}),
		);
	});

	it("gives a blocked card whose blocker holds the same fix only Blocked with that one, and counts blocked in its lane", async () => {
		const view = await testing.open({
			lanes: [{ id: 1, name: "Billing" }],
			todos: [
				todo({ id: 1, subject: "store licenses" }),
				todo({
					id: 2,
					subject: "invoice",
					stage: "queued",
					blockedBy: [1],
					lane: 1,
					position: 1,
				}),
				todo({
					id: 3,
					subject: "email invoices",
					stage: "queued",
					blockedBy: [2],
					lane: 1,
					position: 2,
				}),
			],
		});

		const card = (subject: string) =>
			view
				.getByRole("button", { name: new RegExp(`^${subject}`) })
				.closest("li") as HTMLElement;
		expect(within(card("invoice")).getByText("Blocked")).toBeTruthy();
		expect(within(card("email invoices")).getByText("Queued")).toBeTruthy();
		expect(card("email invoices").textContent).not.toContain("Blocked with");
		const lane = view.getByRole("region", { name: "Billing", hidden: true });
		expect(lane.textContent).toContain("2 blocked");
	});

	it("lists a blocked task's chain in its dialog", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "store licenses" }),
				todo({ id: 2, subject: "check them", blockedBy: [1] }),
				todo({
					id: 3,
					subject: "bill for them",
					stage: "queued",
					blockedBy: [2],
				}),
				todo({
					id: 4,
					subject: "old one",
					stage: "queued",
					blockersLost: [{ id: 9, subject: "gone" }],
				}),
			],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^bill for them/ })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("Blocked");
		const part = within(dialog).getByRole("region", { name: "what blocks it" });
		expect(
			within(part)
				.getAllByRole("listitem")
				.map((row) => row.textContent),
		).toEqual([
			"#1 in Backlogstore licensesavailable",
			"#2 in Backlogcheck themavailable",
		]);
		expect(
			within(part).getByRole("button", { name: "Queue 2 blockers" }),
		).toBeTruthy();

		await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
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

	it("strips a queued card gray, even one waiting on a queued blocker, and one under way blue", async () => {
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
			tasks: [details({ task: "beta" })],
		});

		const badges = within(view.getByRole("list", { name: "Backlog tasks" }))
			.getAllByRole("listitem")
			.map(
				(card) =>
					card.querySelector("[data-status]")?.getAttribute("data-status") ??
					null,
			);
		expect(badges).toEqual(["queued", "queued", null, "running"]);
	});

	it("keeps an unqueued todo queued when the server refuses, saying why", async () => {
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
		expect(view.getByLabelText("Unqueue #1")).toBeTruthy();

		testing.refuseWrites = {
			reason: "not_found",
			message: "task 1 is not in the queue",
		};
		await act(async () => testing.release());

		await waitFor(() => expect(view.getByLabelText("Unqueue #1")).toBeTruthy());
		expect(view.getByRole("alert").textContent).toBe(
			"Not unqueued: task 1 is not in the queue",
		);
	});
});
