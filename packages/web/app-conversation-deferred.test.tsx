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

describe("App's Deferred card", () => {
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

	const board = {
		todos: [
			todo({ id: 812, subject: "Rewrite the upload client", stage: "backlog" }),
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

	it("says why it stopped and what it waits on, with Resume its one way on", async () => {
		const view = await testing.openConversations([deferring], undefined, board);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred upload-retry" }),
		);
		expect(card.textContent).toContain("The fix needs the new client.");
		expect(card.textContent).toContain("Rewrite the upload client");
		expect(card.textContent).toContain("Keep the retry for old clients?");
		expect(card.textContent).toContain("an upstream release");
		// Resume is its one way on; the rest open the task or answer it.
		expect(
			within(card)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual([
			"Taskupload-retry",
			"#812 Rewrite the upload client",
			"Answer",
			"Resume",
		]);

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Resume" })),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES TASK #20]" } },
		]);
	});

	it("records an answer without starting the task", async () => {
		const view = await testing.openConversations([deferring], undefined, board);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred upload-retry" }),
		);
		fireEvent.change(within(card).getByRole("textbox", { name: "answer" }), {
			target: { value: "Yes" },
		});
		fireEvent.click(within(card).getByRole("button", { name: "Answer" }));
		await waitFor(() =>
			expect(testing.posted("/api/todos/20/deferral/answer")).toEqual([
				{ method: "PUT", body: { index: 0, answer: "Yes" } },
			]),
		);
		expect(testing.posted("/api/todos/20/queued")).toEqual([]);
	});

	it("folds to a record once the conversation went on past it", async () => {
		const resumed = conversation({
			title: "Deferring",
			messages: [...deferring.messages, message("user", "[SPLATES TASK #20]")],
		});
		const view = await testing.openConversations([resumed], undefined, board);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred upload-retry" }),
		);
		expect(card.textContent).toContain("Resumed");
		expect(within(card).queryByRole("button", { name: "Resume" })).toBeNull();
		expect(card.textContent).not.toContain("The fix needs the new client.");
	});

	it("lets the person link a blocker to an old deferral, which recorded none", async () => {
		const old = conversation({
			title: "Deferring",
			messages: [
				message(
					"agent",
					"## ⏸ Deferred upload-retry: waiting on the new client\n\nIt set out to retry a 413.",
				),
			],
		});
		const view = await testing.openConversations([old], undefined, {
			todos: [
				todo({
					id: 812,
					subject: "Rewrite the upload client",
					stage: "backlog",
				}),
				todo({ id: 20, subject: "Retry on 413", slug: "upload-retry" }),
			],
			lanes: [],
		});
		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred upload-retry" }),
		);
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
					stage: "backlog",
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
		const view = await testing.openConversations([old], undefined, {
			todos: [todo({ id: 20, subject: "Retry on 413", slug: "upload-retry" })],
			lanes: [],
		});
		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred upload-retry" }),
		);
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
