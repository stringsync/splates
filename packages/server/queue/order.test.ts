import { describe, expect, it } from "bun:test";
import type { TaskRecord } from "../board";
import {
	blockage,
	canStart,
	holdsBack,
	isBlocked,
	queueOrder,
	unqueuedBlockers,
} from "./order";

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
			elsewhere: [],
		});
	});

	it("holds a task until its blockers in other projects merge there", () => {
		const open = { project: "/repos/webappwiz", id: 404, subject: "locale" };
		const waiting = task({ id: 1, stage: "queued", blockedElsewhere: [open] });
		const lost = task({
			id: 2,
			stage: "queued",
			blockedElsewhere: [{ ...open, lost: true }],
		});
		const landed = task({
			id: 3,
			stage: "queued",
			blockedElsewhere: [{ ...open, landed: "abc123" }],
		});
		const all = [waiting, lost, landed];

		expect(holdsBack(waiting, all).elsewhere).toEqual([open]);
		expect(canStart(waiting, all)).toBe(false);
		expect(canStart(lost, all)).toBe(false);
		expect(canStart(landed, all)).toBe(true);
		// The other project's queue starts its task, so this one is not blocked.
		expect(isBlocked(waiting, all)).toBe(false);
	});
});

describe("what blocks a queued task", () => {
	it("is a blocker not queued or removed, here or under a task it waits on, never one queued or running", () => {
		const all = [
			task({ id: 1, blockedBy: [2] }),
			task({ id: 2, stage: "ready" }),
			task({ id: 3, blockersLost: [{ id: 9, subject: "gone" }] }),
			task({ id: 4, blockedBy: [3] }),
			task({ id: 5, blockedBy: [6] }),
			task({ id: 6, stage: "running", takenBy: "alpha" }),
			task({ id: 7, blockedBy: [5] }),
			task({ id: 8, stage: "ready", blockedBy: [2] }),
		];

		expect(blockage(all[0] as TaskRecord, all)).toMatchObject({
			lost: [],
			deep: false,
		});
		expect(ids(blockage(all[0] as TaskRecord, all).chain)).toEqual([2]);
		expect(blockage(all[2] as TaskRecord, all)).toMatchObject({
			chain: [],
			lost: [9],
		});
		expect(blockage(all[3] as TaskRecord, all)).toMatchObject({
			chain: [],
			lost: [],
			deep: true,
		});
		expect(
			all.filter((each) => isBlocked(each, all)).map((each) => each.id),
		).toEqual([1, 3, 4]);
	});
});

describe("the blockers not queued", () => {
	it("finds the whole chain not queued, blockers first, past queued and asked ones", () => {
		const all = [
			task({ id: 1, blockedBy: [2, 5] }),
			task({ id: 2, stage: "queued", blockedBy: [3] }),
			task({ id: 3, stage: "backlog", blockedBy: [4] }),
			task({ id: 4, stage: "ready" }),
			task({ id: 5, stage: "ready", blockedBy: [4] }),
		];

		expect(ids(unqueuedBlockers([1], all))).toEqual([4, 3, 5]);
		expect(ids(unqueuedBlockers([1, 3], all))).toEqual([4, 5]);
	});

	it("stops at a task under way, and finds none for one free to start", () => {
		const all = [
			task({ id: 1, blockedBy: [2] }),
			task({ id: 2, stage: "ready", takenBy: "alpha", blockedBy: [3] }),
			task({ id: 3, stage: "ready" }),
			task({ id: 4 }),
		];

		expect(unqueuedBlockers([1], all)).toEqual([]);
		expect(unqueuedBlockers([4], all)).toEqual([]);
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
