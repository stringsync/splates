import { describe, expect, it } from "bun:test";
import type { TaskRecord } from "../board";
import { canStart, holdsBack, queueOrder } from "./order";

describe("the queue's order", () => {
	it("takes queued tasks no agent has, in list order", () => {
		const all = [
			task({ id: 1, position: 2 }),
			task({ id: 2, position: 1 }),
			task({ id: 3, position: 3, stage: "ready" }),
			task({ id: 4, position: 4, takenBy: "alpha" }),
		];

		expect(ids(queueOrder(all))).toEqual([2, 1]);
	});

	it("puts each after every queued task it is blocked by, however they sit", () => {
		const all = [
			task({ id: 1, position: 1, blockedBy: [3] }),
			task({ id: 2, position: 2 }),
			task({ id: 3, position: 3, blockedBy: [4] }),
			task({ id: 4, position: 4 }),
		];

		expect(ids(queueOrder(all))).toEqual([2, 4, 3, 1]);
	});

	it("leaves one blocked by a task out of the queue where it sits", () => {
		const all = [
			task({ id: 1, position: 1, blockedBy: [2] }),
			task({ id: 2, position: 2, stage: "backlog" }),
			task({ id: 3, position: 3 }),
		];

		expect(ids(queueOrder(all))).toEqual([1, 3]);
		expect(canStart(all[0] as TaskRecord, all)).toBeFalse();
		expect(canStart(all[2] as TaskRecord, all)).toBeTrue();
	});

	it("names the open tasks it is blocked by, and those removed unmerged", () => {
		const all = [
			task({
				id: 1,
				blockedBy: [2],
				blockersLost: [{ id: 9, subject: "gone" }],
			}),
			task({ id: 2, takenBy: "beta" }),
		];

		expect(holdsBack(all[0] as TaskRecord, all)).toEqual({
			open: [all[1] as TaskRecord],
			lost: [9],
		});
	});
});

function task(overrides: Partial<TaskRecord>): TaskRecord {
	return {
		id: 1,
		subject: `task ${overrides.id ?? 1}`,
		text: "",
		position: overrides.id ?? 1,
		from: null,
		createdAt: "2026-10-19T00:00:00.000Z",
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		stage: "queued",
		...overrides,
	};
}

function ids(tasks: TaskRecord[]): number[] {
	return tasks.map((each) => each.id);
}
