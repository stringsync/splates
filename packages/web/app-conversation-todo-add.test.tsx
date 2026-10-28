import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import { resize, workTimeline } from "./drivers";
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
		resize(1024, 768);
		testing.dispose();
	});

	it("draws an added todo in the timeline as one line naming it, and a refused add with its reason", async () => {
		expect(within(thread).queryAllByRole("note", { name: "splates" })).toEqual(
			[],
		);
		const timeline = workTimeline(thread);

		expect(quietLines(timeline).map((line) => line.textContent)).toEqual([
			"Added#4 Upload retries forever on a 413",
			"task add: usage",
		]);
	});

	it("restores the direct Remove and Undo controls on a phone", async () => {
		act(() => resize(390, 844));
		const timeline = workTimeline(thread);
		const line = quietLines(timeline)[0] as HTMLElement;
		expect(line.textContent).toBe(
			"Added#4 Upload retries forever on a 413Remove",
		);

		await act(async () =>
			fireEvent.click(within(line).getByRole("button", { name: "Remove" })),
		);

		expect(testing.posted("/api/todos/4")).toMatchObject([
			{ method: "DELETE" },
		]);
		testing.served = { ...testing.served, todos: [] };
		await act(async () => testing.stream?.onmessage?.());
		await waitFor(() => within(line).getByRole("button", { name: "Undo" }));
	});

	it("removes the todo from its line, and puts it back with Undo", async () => {
		const timeline = workTimeline(thread);
		const line = quietLines(timeline)[0] as HTMLElement;
		fireEvent.click(
			within(line).getByRole("button", { name: /Upload retries/ }),
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove" })),
		);

		expect(testing.posted("/api/todos/4")).toMatchObject([
			{ method: "DELETE" },
		]);
		const listed = testing.served.todos;
		testing.served = { ...testing.served, todos: [] };
		await act(async () => testing.stream?.onmessage?.());
		const removed = await waitFor(() => {
			const [first] = quietLines(timeline);
			expect(first?.textContent).toStartWith("Removed");
			return first as HTMLElement;
		});
		expect(removed.textContent).toBe(
			"Removed#4 Upload retries forever on a 413",
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Undo" })),
		);

		expect(testing.posted("/api/todos/4/restore")).toMatchObject([
			{ method: "POST" },
		]);
		testing.served = { ...testing.served, todos: listed };
		await act(async () => testing.stream?.onmessage?.());
		await waitFor(() =>
			view.getByRole("button", {
				name: "Remove",
			}),
		);
	});

	it("opens the todo from its chip", async () => {
		const timeline = workTimeline(thread);
		const line = quietLines(timeline)[0] as HTMLElement;

		await act(async () =>
			fireEvent.click(
				within(line).getByRole("button", { name: /Upload retries/ }),
			),
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open task #4" })),
		);
		await waitFor(() => view.getByRole("dialog", { name: /Task 4/ }));
	});
});

/** The lines of the timeline's quiet events. */
function quietLines(timeline: HTMLElement): HTMLElement[] {
	return [
		...timeline.querySelectorAll<HTMLElement>('[data-slot="quiet-event"]'),
	];
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
