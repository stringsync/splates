import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "../events";
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
				command: "arbor todo add 'Upload retries forever on a 413'",
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

	it("draws an added todo as one line naming it, and a refused add as none", async () => {
		const lines = await waitFor(() =>
			within(thread).getAllByRole("note", { name: "arbor" }),
		);

		expect(lines.map((line) => line.textContent)).toEqual([
			"Added#4 Upload retries forever on a 413",
		]);
	});

	it("opens the todo from its chip", async () => {
		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "arbor" }),
		);

		await act(async () =>
			fireEvent.click(
				within(line).getByRole("button", { name: /Upload retries/ }),
			),
		);

		await waitFor(() => view.getByRole("dialog", { name: /Todo 4/ }));
	});
});

/** A todo add the agent ran at `secs`, adding todo `id` to lane 1. */
function added(id: number, secs: number): Event {
	return {
		id: `add-${id}`,
		at: second(secs),
		action: "todo add",
		task: null,
		reason: null,
		conversation: "c1",
		todo: id,
		subject: "Upload retries forever on a 413",
		lane: 1,
		position: 2,
	};
}

/** A todo add the agent ran at `secs`, refused. */
function refused(secs: number): Event {
	return {
		id: "refused",
		at: second(secs),
		action: "todo add",
		task: null,
		reason: "usage",
		conversation: "c1",
	};
}
