import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	snapshot,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's permission card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.servedOf.shop = snapshot({
			project: "shop",
			todos: [
				todo({ id: 404, subject: "Fix the cart", stage: "ready" }),
				todo({ id: 405, subject: "Ship the cart", stage: "queued" }),
			],
		});
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const cartAsking = conversation({
		title: "Cart",
		messages: [
			message(
				"agent",
				[
					"## 🔐 Permission: queue shop #404: the cart",
					"",
					"Ours waits on it.",
				].join("\n"),
			),
		],
	});
	const asking = conversation({
		title: "Billing",
		messages: [
			message(
				"agent",
				[
					"## 🔐 Permission: queue lane 3: Billing export",
					"",
					"Two tasks, the writer first.",
				].join("\n"),
			),
		],
	});

	const board = {
		todos: [
			todo({ id: 31, subject: "Write the CSV", lane: 3, stage: "ready" }),
			todo({ id: 32, subject: "Serve the export", lane: 3, stage: "ready" }),
		],
		lanes: [{ id: 3, name: "Billing export" }],
	};

	// A queue with more ahead than the card shows, and a lane task blocked.
	const busy = {
		todos: [
			todo({ id: 31, subject: "Write the CSV", lane: 3, stage: "ready" }),
			todo({
				id: 32,
				subject: "Serve the export",
				lane: 3,
				stage: "ready",
				blockedBy: [31],
			}),
			...[11, 12, 13, 14].map((id) =>
				todo({ id, subject: `Queued ${id}`, stage: "queued" }),
			),
		],
		lanes: [{ id: 3, name: "Billing export" }],
	};
	// Tasks named one by one, not a lane.
	const tasks = conversation({
		title: "Billing",
		messages: [
			message(
				"agent",
				[
					"## 🔐 Permission: queue #31, #32: the export",
					"",
					"Both at once.",
				].join("\n"),
			),
		],
	});
	// The lane queued already, from the board or a terminal.
	const queuedLane = {
		...board,
		lanes: [{ id: 3, name: "Billing export", queued: true as const }],
	};

	/** The Billing export queue card, on a page showing `shown`. */
	const queueCard = async (shown: typeof board) => {
		const view = await testing.openConversations([asking], undefined, shown);
		return waitFor(() =>
			view.getByRole("region", { name: "queue Billing export" }),
		);
	};

	it("counts as running only the todos an agent is still on", async () => {
		const view = await testing.openConversations([asking], undefined, {
			...board,
			todos: [
				...board.todos,
				todo({ id: 41, subject: "Live", stage: "running", takenBy: "alpha" }),
				todo({ id: 42, subject: "Gone", stage: "running", takenBy: "ghost" }),
				todo({ id: 43, subject: "Dead", stage: "running", takenBy: "dead" }),
			],
			tasks: [
				details({ task: "alpha", lease: "held" }),
				details({ task: "dead", status: "working", lease: "stale" }),
			],
		});
		const card = await waitFor(() =>
			view.getByRole("region", { name: "queue Billing export" }),
		);
		expect(card.textContent).toContain("1 running");
	});

	it("lists the lane's tasks, and Queue lane queues the lane from the page itself", async () => {
		const card = await queueCard(board);
		expect(card.textContent).toContain("Write the CSV");
		expect(card.textContent).toContain("Serve the export");
		expect(card.textContent).toContain("Two tasks, the writer first.");
		// The command to queue it from a terminal instead, which the card copies.
		expect(
			within(card)
				.getByRole("button", { name: "copy splates lane queue 3" })
				.getAttribute("title"),
		).toBe("splates lane queue 3");

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /Queue lane/ })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes/3",
			method: "PUT",
			body: JSON.stringify({ queued: true }),
		});
	});

	it("offers to archive the conversation once its Queue lane has queued the lane", async () => {
		const card = await queueCard(board);
		expect(within(card).queryByRole("button", { name: "Archive" })).toBeNull();

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /Queue lane/ })),
		);
		// Held until the server lists the lane queued.
		expect(within(card).queryByRole("button", { name: "Archive" })).toBeNull();
		testing.served = snapshot(queuedLane);
		await act(async () => testing.stream?.onmessage?.());
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					within(card).getByRole("button", { name: "Archive" }),
				),
			),
		);

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("offers to archive the conversation once its lane is queued anywhere else", async () => {
		const view = await testing.openConversations(
			[asking],
			undefined,
			queuedLane,
		);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "queue Billing export" }),
		);

		expect(card.textContent).toContain("Queued lane Billing export");
		expect(within(card).getByRole("button", { name: "Archive" })).toBeTruthy();
	});

	it("shows the queue it joins: what is queued ahead, then each task joining or after what blocks it", async () => {
		const card = await queueCard(busy);
		const rows = [...card.querySelectorAll("li")].map((li) => li.textContent);
		expect(rows).toEqual([
			"1 more queued ahead",
			"#12Queued 12queued · 2",
			"#13Queued 13queued · 3",
			"#14Queued 14queued · 4",
			"#31Write the CSVjoins",
			"#32Serve the exportafter #31",
		]);
	});

	it("queues tasks named one by one with a button that counts them", async () => {
		const view = await testing.openConversations([tasks], undefined, board);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "queue the export" }),
		);
		expect(card.textContent).toContain("Add the export to the queue");
		expect(
			within(card).getByRole("button", { name: /Queue 2 tasks/ }),
		).toBeTruthy();
	});

	it("shows what removing a lane takes with it, and Remove now removes it from the page", async () => {
		const removing = conversation({
			title: "Billing",
			messages: [
				message(
					"agent",
					[
						"## 🔐 Permission: remove lane 3: Billing export",
						"",
						"`splates lane remove 3`",
						"",
						"Nothing in it is wanted now.",
					].join("\n"),
				),
			],
		});
		const view = await testing.openConversations([removing], undefined, board);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "remove Billing export" }),
		);
		expect(card.textContent).toContain("Its 2 tasks go with it.");
		expect(card.textContent).toContain("Write the CSV");
		expect(
			within(card).getByRole("button", { name: "copy splates lane remove 3" }),
		).toBeTruthy();

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /Remove now/ })),
		);

		expect(testing.posts.at(-1)).toMatchObject({ method: "DELETE" });
		expect(testing.posts.at(-1)?.path).toContain("/api/lanes/3");
	});

	it("queues another project's tasks through that project, from its own board", async () => {
		const view = await testing.openConversations(
			[cartAsking],
			undefined,
			board,
		);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "queue shop the cart" }),
		);
		await waitFor(() => expect(card.textContent).toContain("Fix the cart"));
		expect(card.textContent).toContain("Add shop the cart to its queue");
		expect(
			within(card).getByRole("button", {
				name: "copy splates --project shop queue add 404",
			}),
		).toBeTruthy();
		// Its place in shop's queue, and each task opens shop's board.
		expect(card.textContent).toContain("queued · 1");
		expect(
			within(card).getByRole("button", { name: "Fix the cart" }),
		).toBeTruthy();

		// What shop's board reads once the queue lands, read again after.
		testing.servedOf.shop = snapshot({
			project: "shop",
			todos: [todo({ id: 404, subject: "Fix the cart", stage: "queued" })],
		});
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /Queue task/ })),
		);

		expect(testing.posted("/api/todos/404/queued?project=shop")).toEqual([
			{ method: "PUT", body: { queued: true } },
		]);
		await waitFor(() =>
			expect(card.textContent).toContain("Queued shop the cart"),
		);
	});
});
