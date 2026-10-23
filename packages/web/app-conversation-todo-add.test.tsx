import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import {
	act,
	cleanup,
	fireEvent,
	second,
	Testing,
	todo,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's todo add events", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["openConversations"]>>;
	let thread: HTMLElement;

	beforeEach(async () => {
		testing = new Testing();
		const state = turn([
			tool({
				id: "x1",
				command: "splates todo add 'Upload retries forever on a 413'",
				at: second(2),
				until: second(3),
			}),
			"Noted for later.",
		]);
		view = await testing.openConversations(
			[{ ...state, events: [added(4, 2.5), refused(2.8)] }],
			undefined,
			{
				todos: [todo({ id: 4, subject: "Upload retries forever on a 413" })],
				lanes: [],
			},
		);
		thread = await waitFor(() => view.getByRole("region", { name: "Tests" }));
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("draws an added todo in the dialog as one line naming it, and a refused add as none", async () => {
		expect(within(thread).queryAllByRole("note", { name: "splates" })).toEqual(
			[],
		);
		const dialog = await quietDialog(thread);
		const lines = within(dialog).getAllByRole("note", { name: "splates" });

		expect(lines.map((line) => line.textContent)).toEqual([
			"Added#4 Upload retries forever on a 413Remove",
		]);
	});

	it("removes the todo from its line, and puts it back with Undo", async () => {
		const dialog = await quietDialog(thread);
		const line = within(dialog).getByRole("note", { name: "splates" });

		await act(async () =>
			fireEvent.click(within(line).getByRole("button", { name: "Remove" })),
		);

		expect(testing.posted("/api/todos/4")).toMatchObject([
			{ method: "DELETE" },
		]);
		const listed = testing.served.todos;
		testing.served = { ...testing.served, todos: [] };
		await act(async () => testing.stream?.onmessage?.());
		const removed = await waitFor(() =>
			within(dialog).getByRole("note", { name: "splates" }),
		);
		expect(removed.textContent).toBe(
			"Removed#4 Upload retries forever on a 413Undo",
		);

		await act(async () =>
			fireEvent.click(within(removed).getByRole("button", { name: "Undo" })),
		);

		expect(testing.posted("/api/todos/4/restore")).toMatchObject([
			{ method: "POST" },
		]);
		testing.served = { ...testing.served, todos: listed };
		await act(async () => testing.stream?.onmessage?.());
		await waitFor(() =>
			within(within(dialog).getByRole("note", { name: "splates" })).getByRole(
				"button",
				{ name: "Remove" },
			),
		);
	});

	it("opens the todo from its chip", async () => {
		const dialog = await quietDialog(thread);
		const line = within(dialog).getByRole("note", { name: "splates" });

		await act(async () =>
			fireEvent.click(
				within(line).getByRole("button", { name: /Upload retries/ }),
			),
		);

		await waitFor(() => view.getByRole("dialog", { name: /Task 4/ }));
	});
});

/** Opens the counts of a thread's quiet events, and gives the dialog they open to. */
async function quietDialog(thread: HTMLElement): Promise<HTMLElement> {
	fireEvent.click(
		await waitFor(() =>
			within(thread).getByRole("button", { name: "quiet events" }),
		),
	);
	return await waitFor(() =>
		within(document.body).getByRole("dialog", {
			name: "What it did on the side",
		}),
	);
}

/** A todo add the agent ran at `secs`, adding todo `id` to lane 1. */
function added(id: number, secs: number): Event {
	return {
		id: `add-${id}`,
		at: second(secs),
		action: "task add",
		task: null,
		reason: null,
		conversation: "c1",
		number: id,
		subject: "Upload retries forever on a 413",
		lane: 1,
		position: 2,
		ready: true,
	};
}

/** A todo add the agent ran at `secs`, refused. */
function refused(secs: number): Event {
	return {
		id: "refused",
		at: second(secs),
		action: "task add",
		task: null,
		reason: "usage",
		conversation: "c1",
	};
}
