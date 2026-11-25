import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	snapshot,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's Blocked card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const deferring = conversation({
		title: "Deferring",
		messages: [
			message(
				"agent",
				"## ⏸ Deferred upload-retry: waiting on #812 and your call\n\nIt set out to retry a 413.",
			),
		],
	});

	const old = conversation({
		title: "Deferring",
		messages: [
			message(
				"agent",
				"## ⏸ Deferred upload-retry: waiting on the new client\n\nIt set out to retry a 413.",
			),
		],
	});

	const openCard = async (
		opened: ReturnType<typeof conversation>,
		served: typeof board,
	) => {
		const view = await testing.openConversations([opened], undefined, served);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred upload-retry" }),
		);
		return { view, card };
	};

	const board = {
		todos: [
			todo({
				id: 812,
				subject: "Rewrite the upload client",
				stage: "available",
			}),
			todo({
				id: 20,
				subject: "Retry on 413",
				blockedBy: [812],
				deferred: {
					why: "The fix needs the new client.",
					at: "2026-10-27T10:00:00.000Z",
					task: "upload-retry",
					tasks: [{ id: 812, subject: "Rewrite the upload client" }],
					questions: [{ text: "Keep the retry for old clients?" }],
					outside: [{ what: "an upstream release" }],
				},
			}),
		],
		lanes: [],
	};

	it("says why it stopped, what it waits on and that it is back on the board", async () => {
		const { card } = await openCard(deferring, board);
		expect(card.textContent).toContain("The fix needs the new client.");
		expect(card.textContent).toContain("Rewrite the upload client");
		expect(card.textContent).toContain("Keep the retry for old clients?");
		expect(card.textContent).toContain("an upstream release");
		expect(card.textContent).toContain(
			"can start once its blockers are queued and done",
		);
		expect(
			within(card)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual([
			"Taskupload-retry",
			"#812 Rewrite the upload client",
			"Queue 1 blocker",
		]);
	});

	it("queues a blocker, or all of them, from the card", async () => {
		const { card } = await openCard(deferring, board);
		fireEvent.click(
			within(card).getByRole("button", { name: "Queue 1 blocker" }),
		);
		await waitFor(() =>
			expect(testing.posted("/api/todos/812/queued")).toEqual([
				{ method: "PUT", body: { queued: true } },
			]),
		);
	});

	it("says all blockers are queued once none is left for the person to queue", async () => {
		const { card } = await openCard(deferring, {
			todos: board.todos.map((each) =>
				each.id === 812 ? { ...each, stage: "queued" as const } : each,
			),
			lanes: [],
		});
		expect(card.textContent).toContain("Starts automatically");
		expect(
			within(card).queryByRole("button", { name: /^Queue \d/ }),
		).toBeNull();
	});

	it("lists an older deferral's outside wait as a note that holds nothing back", async () => {
		const { card } = await openCard(deferring, {
			todos: board.todos.filter((each) => each.id !== 812),
			lanes: [],
		});
		expect(card.textContent).toContain("an upstream release");
		expect(card.textContent).toContain("Every blocker is done.");
		expect(card.textContent).not.toContain("nothing detects yet");
	});

	it("marks the row with the warning triangle only while a blocker needs queuing", async () => {
		const { view } = await openCard(deferring, board);
		const mark = await waitFor(() =>
			view.getByRole("img", { name: "deferred" }),
		);
		expect(mark.innerHTML).toContain("text-warning");
		cleanup();
		const queuedAll = await openCard(deferring, {
			todos: board.todos.map((each) =>
				each.id === 812 ? { ...each, stage: "queued" as const } : each,
			),
			lanes: [],
		});
		const quiet = await waitFor(() =>
			queuedAll.view.getByRole("img", { name: "deferred" }),
		);
		expect(quiet.innerHTML).toContain("lucide-hourglass");
		expect(queuedAll.view.getByText("Waiting on blockers")).toBeTruthy();
	});

	it("offers no archive bar for a blocked task, whose conversation the menu archives", async () => {
		const view = await testing.openConversations([deferring], undefined, board);
		await waitFor(() =>
			view.getByRole("region", { name: "deferred upload-retry" }),
		);
		expect(view.queryByRole("region", { name: "archive" })).toBeNull();
	});

	it("folds to a line naming what it waits on once the conversation went on past it", async () => {
		const resumed = conversation({
			title: "Deferring",
			messages: [...deferring.messages, message("user", "[SPLATES TASK #20]")],
		});
		const { card } = await openCard(resumed, board);
		expect(card.textContent).toContain("waits on #812");
		expect(within(card).queryByRole("button", { name: "Resume" })).toBeNull();
		expect(card.textContent).not.toContain("The fix needs the new client.");
	});

	it("shows again at the bottom, its first card a line, while the conversation talks on", async () => {
		const talking = conversation({
			title: "Deferring",
			messages: [
				...deferring.messages,
				message("user", "Why is it blocked?"),
				message("agent", "It needs the new client."),
			],
		});
		const view = await testing.openConversations([talking], undefined, board);
		const pinned = await waitFor(() =>
			view.getByRole("region", { name: "blocked upload-retry" }),
		);
		expect(pinned.textContent).toContain("Rewrite the upload client");
		const first = view.getByRole("region", { name: "deferred upload-retry" });
		expect(first.textContent).toContain("waits on #812");
		expect(first.textContent).not.toContain("The fix needs the new client.");

		fireEvent.click(within(first).getByRole("button", { name: "Show" }));
		expect(first.textContent).toContain("It set out to retry a 413.");
		fireEvent.click(within(first).getByRole("button", { name: "Hide" }));
		expect(first.textContent).not.toContain("It set out to retry a 413.");
	});

	it("lets the person link a blocker to an old deferral, which recorded none", async () => {
		const { view, card } = await openCard(old, {
			todos: [
				todo({
					id: 812,
					subject: "Rewrite the upload client",
					stage: "available",
				}),
				todo({ id: 20, subject: "Retry on 413", slug: "upload-retry" }),
			],
			lanes: [],
		});
		expect(card.textContent).toContain("It set out to retry a 413.");

		fireEvent.click(
			within(card).getByRole("button", { name: "Link a blocker" }),
		);
		fireEvent.click(
			await waitFor(() =>
				view.getByRole("button", { name: /Rewrite the upload client/ }),
			),
		);
		await waitFor(() =>
			expect(testing.posted("/api/todos/20/blocked-by")).toEqual([
				{ method: "PUT", body: { blockedBy: [812] } },
			]),
		);
		// Held until the server lists the link.
		expect(
			within(card).queryByRole("button", { name: "Queue to run after #812" }),
		).toBeNull();
		testing.served = snapshot({
			todos: [
				todo({
					id: 812,
					subject: "Rewrite the upload client",
					stage: "available",
				}),
				todo({
					id: 20,
					subject: "Retry on 413",
					slug: "upload-retry",
					blockedBy: [812],
				}),
			],
			lanes: [],
		});
		await act(async () => testing.stream?.onmessage?.());
		await waitFor(() =>
			within(card).getByRole("button", { name: "Queue to run after #812" }),
		);
	});

	it("queues an old deferral from its card, once nothing is linked", async () => {
		const old = conversation({
			title: "Deferring",
			messages: [
				message("agent", "## ⏸ Deferred upload-retry: waiting\n\nIt set out."),
			],
		});
		const { card } = await openCard(old, {
			todos: [todo({ id: 20, subject: "Retry on 413", slug: "upload-retry" })],
			lanes: [],
		});
		expect(card.textContent).toContain("Link what it waits on");
		fireEvent.click(within(card).getByRole("button", { name: "Queue" }));
		await waitFor(() =>
			expect(testing.posted("/api/todos/20/queued")).toEqual([
				{ method: "PUT", body: { queued: true } },
			]),
		);
		// Not said queued until the board shows it.
		expect(card.textContent).not.toContain("Queued");
	});
});
