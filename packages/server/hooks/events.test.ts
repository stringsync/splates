import { describe, expect, it } from "bun:test";
import type { Event } from "../records";
import { taskEventsOf } from "./events";

describe("taskEventsOf", () => {
	it("makes naming a model ready a task, as well as updating it", () => {
		const update = event({
			action: "task update",
			number: 3,
			subject: "Totals",
			changed: { assignee: { agent: "claude" } },
		});

		expect(taskEventsOf(update).map(({ name }) => name)).toEqual([
			"task.updated",
			"task.ready",
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
