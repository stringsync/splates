import { describe, expect, it } from "bun:test";
import type { Event } from "../records";
import { taskEventsOf } from "./events";

describe("taskEventsOf", () => {
	it("makes a task ready when it is added groomed, not deferred", () => {
		const added = (number: number, ready: boolean) =>
			names(
				event({
					action: "task add",
					number,
					subject: "Totals",
					lane: null,
					position: number,
					ready,
				}),
			);

		expect(added(4, true)).toEqual(["task.created", "task.ready"]);
		expect(added(5, false)).toEqual(["task.created"]);
	});

	it("makes a task ready when an update grooms it, not when it names a model", () => {
		const updated = (changed: Record<string, unknown>) =>
			names(
				event({ action: "task update", number: 3, subject: "Totals", changed }),
			);

		expect(updated({ ready: true })).toEqual(["task.updated", "task.ready"]);
		expect(updated({ assignee: { agent: "claude" } })).toEqual([
			"task.updated",
		]);
	});

	it("names the started task a merge or start is about", () => {
		const merged = event({
			action: "merge",
			task: "totals",
			base: "main",
			commit: "abc1234",
			files: [],
			attemptsLeft: 2,
			failedTests: [],
		});

		expect(taskEventsOf(merged)).toEqual([
			{
				name: "task.done",
				from: "e1",
				at: "2026-10-19T00:00:00.000Z",
				numbers: [],
				task: "totals",
			},
		]);
	});

	it("gives nothing for a refused command, or one no task's life moves on", () => {
		expect(
			taskEventsOf(event({ action: "task add", reason: "usage" })),
		).toEqual([]);
		expect(taskEventsOf(event({ action: "tell", to: "beta" }))).toEqual([]);
	});
});

function names(each: Event): string[] {
	return taskEventsOf(each).map(({ name }) => name);
}

function event(fields: Record<string, unknown>): Event {
	return {
		id: "e1",
		at: "2026-10-19T00:00:00.000Z",
		task: null,
		reason: null,
		conversation: null,
		...fields,
	} as unknown as Event;
}
