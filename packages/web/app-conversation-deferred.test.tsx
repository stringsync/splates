import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	fireEvent,
	message,
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

	it("says why it stopped and what unblocks it, queueing the blocker then the task", async () => {
		const view = await testing.openConversations([deferring], undefined, board);
		const card = await waitFor(() =>
			view.getByRole("region", { name: "deferred upload-retry" }),
		);
		expect(card.textContent).toContain("The fix needs the new client.");
		expect(card.textContent).toContain("Keep the retry for old clients?");

		fireEvent.click(
			within(card).getByRole("button", { name: "Queue to run after #812" }),
		);
		await waitFor(() =>
			expect(testing.posted("/api/todos/812/queued")).toEqual([
				{ method: "PUT", body: { queued: true } },
			]),
		);
		await waitFor(() =>
			expect(testing.posted("/api/todos/20/queued")).toEqual([
				{ method: "PUT", body: { queued: true } },
			]),
		);

		fireEvent.click(within(card).getByRole("button", { name: "Mark done" }));
		await waitFor(() =>
			expect(testing.posted("/api/todos/20/deferral/outside")).toEqual([
				{ method: "PUT", body: { index: 0 } },
			]),
		);
	});
});
