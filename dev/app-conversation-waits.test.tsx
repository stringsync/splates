import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import type { Event } from "../events";
import {
	cleanup,
	second,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's waits", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The thread of a turn, opened with `events`. */
	const opened = async (state: ConversationState, events: Event[]) => {
		const view = await testing.openConversations([{ ...state, events }]);
		return await waitFor(() => view.getByRole("region", { name: "Tests" }));
	};

	/** The one line in the thread opened with `events`, its turn going or not. */
	const line = async (events: Event[], going = true) => {
		const thread = await opened(
			turn(
				[
					tool({
						id: "x1",
						command: "arbor wait alpha",
						status: going ? "in_progress" : "completed",
						at: second(2),
					}),
				],
				{ status: going ? "running" : "idle" },
			),
			events,
		);
		return await waitFor(() =>
			within(thread).getByRole("note", { name: "arbor" }),
		);
	};

	it("counts down to its timeout while it runs", async () => {
		const found = await line([began("alpha", inMins(9))]);

		expect(found.textContent).toMatch(/^Waiting onalpha(9:00|8:59)$/);
		expect(found.dataset.live).toBe("true");
	});

	it("names a todo or a cred it waits on by its chip", async () => {
		const todo = await line([
			{
				...began("alpha", inMins(9)),
				action: "todo wait",
				task: null,
				todo: 7,
				subject: "Seven",
			} as Event,
		]);
		expect(todo.textContent).toMatch(/^Waiting on#7 Seven\d:\d\d$/);
		cleanup();

		const cred = await line([
			{
				...began("alpha", inMins(9)),
				action: "creds wait",
				task: null,
				name: "API_TOKEN",
			} as Event,
		]);
		expect(cred.textContent).toMatch(/^Waiting onAPI_TOKEN\d:\d\d$/);
	});

	it("goes once what it waited on came", async () => {
		const thread = await opened(turn(["Merged."]), [
			began("alpha", inMins(9)),
			ended(null),
		]);

		await waitFor(() => expect(thread.textContent).toContain("Merged."));
		expect(within(thread).queryAllByRole("note", { name: "arbor" })).toEqual(
			[],
		);
	});

	it("says it timed out, marked, in its own place", async () => {
		const found = await line(
			[began("alpha", inMins(9)), ended("timeout")],
			false,
		);

		expect(found.textContent).toBe("Wait timed outalpha");
		expect(within(found).getByLabelText("Failed")).toBeTruthy();
	});

	it("shows as cut off once its turn ended without it", async () => {
		const found = await line([began("alpha", inMins(9))], false);

		expect(found.textContent).toBe("Wait cut offalpha");
		expect(found.dataset.live).toBeUndefined();
	});

	it("shows as cut off once past its time with no end", async () => {
		const found = await line([began("alpha", inMins(-1))]);

		expect(found.textContent).toBe("Wait cut offalpha");
	});
});

/** An ISO time `mins` from now. */
function inMins(mins: number): string {
	return new Date(Date.now() + mins * 60_000).toISOString();
}

/** A wait on `task` the agent began at 3s, giving up at `until`. */
function began(task: string, until: string): Event {
	return {
		id: "w",
		at: second(3),
		action: "wait",
		task,
		reason: null,
		conversation: "c1",
		until,
		began: null,
	};
}

/** The end of the wait `began` made, at 4s, refused as `reason` unless null. */
function ended(reason: string | null): Event {
	return {
		id: "w-end",
		at: second(4),
		action: "wait",
		task: "alpha",
		reason,
		conversation: "c1",
		until: second(600),
		began: "w",
	} as Event;
}
