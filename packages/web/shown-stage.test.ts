import { expect, test } from "bun:test";
import type { TaskRecord } from "@splates/server/board";
import { shownStage, stageLabel } from "./todo-queue";

test("a taken task whose agent deferred on an open task is blocked", () => {
	const waiting = record({ id: 2, stage: "available" });
	const mine = record({
		takenBy: "a",
		blockedBy: [2],
		deferred: deferral([2]),
	});
	expect(shownStage(mine, [mine, waiting], ["a"])).toBe("blocked");
	expect(stageLabel(mine, [mine, waiting], ["a"])).toBe("Blocked");
});

test("a taken task with no task of its own left is stalled", () => {
	const mine = record({ takenBy: "gone" });
	expect(shownStage(mine, [mine], ["other"])).toBe("stalled");
	expect(shownStage(mine, [mine], ["gone"])).toBe("running");
	// Without the tasks to look at, it is not called stalled.
	expect(shownStage(mine, [mine])).toBe("running");
});

function record(fields: Partial<TaskRecord>): TaskRecord {
	return {
		id: 1,
		subject: "x",
		text: "",
		position: 1,
		from: null,
		createdAt: "2026-11-01T00:00:00.000Z",
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		stage: "available",
		...fields,
	} as TaskRecord;
}

const deferral = (tasks: number[]) => ({
	why: "waits",
	at: "2026-11-01T00:00:00.000Z",
	task: "a",
	tasks: tasks.map((id) => ({ id, subject: "s" })),
	questions: [],
	outside: [],
});
