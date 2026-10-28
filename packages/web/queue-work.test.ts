import { describe, expect, it } from "bun:test";
import type { TaskRecord } from "@stringsync/splates-server/board";
import { todo } from "@stringsync/splates-server/fixtures";
import { QueueWork, type QueueWrites } from "./queue-work";

/** Writes that only note what they were asked, as the server would take them. */
class NotedWrites implements QueueWrites {
	readonly noted: string[] = [];

	async queueLane(id: number, queued: boolean): Promise<void> {
		this.noted.push(`lane ${id} ${queued}`);
	}

	async queueTodo(id: number, queued: boolean): Promise<void> {
		this.noted.push(`#${id} ${queued}`);
	}
}

const shown = async (_: unknown, write: Promise<unknown>): Promise<void> => {
	await write;
};

describe("QueueWork", () => {
	it("queues a lane's tasks at once, named as the board has it", async () => {
		const writes = new NotedWrites();
		const work = new QueueWork(
			{ action: "queue", lane: 3, tasks: [], title: "Old name", body: "" },
			{
				linked: true,
				lanes: [{ id: 3, name: "Billing export" }],
				todos: [
					todo({ id: 1, lane: 3 }),
					todo({ id: 3, lane: 3 }),
					todo({ id: 2, lane: null }),
				],
			},
		);

		expect(work.name).toBe("Billing export");
		expect(work.todos.map(({ id }) => id)).toEqual([1, 3]);
		expect(work.queued).toBe(false);
		await work.queue(shown, writes);
		expect(writes.noted).toEqual(["lane 3 true"]);
	});

	it("queues only the task of a lane of one, not the lane", async () => {
		const writes = new NotedWrites();
		const work = new QueueWork(
			{ action: "queue", lane: 3, tasks: [], title: null, body: "" },
			{
				linked: true,
				lanes: [{ id: 3, name: "Billing export" }],
				todos: [todo({ id: 1, lane: 3 })],
			},
		);

		expect(work.command).toBe("splates queue add 1");
		await work.queue(shown, writes);
		expect(writes.noted).toEqual(["#1 true"]);
	});

	it("queues each named task yet to start and not yet queued", async () => {
		const writes = new NotedWrites();
		const work = new QueueWork(
			{ action: "queue", lane: null, tasks: [4, 5, 6], title: null, body: "" },
			{
				linked: true,
				lanes: [],
				todos: [
					todo({ id: 4, stage: "ready" }),
					todo({ id: 5, stage: "queued" }),
					todo({ id: 6, takenBy: "fix-upload" }),
				],
			},
		);

		expect(work.name).toBe("#4, #5, #6");
		await work.queue(shown, writes);
		expect(writes.noted).toEqual(["#4 true"]);
	});

	it("is queued once each lane task is queued or let go, and gone once the board drops it", () => {
		const proposal = {
			action: "queue" as const,
			lane: 3,
			tasks: [],
			title: null,
			body: "",
		};
		const board = (todos: TaskRecord[]) => ({
			linked: true,
			lanes: [{ id: 3, name: "Billing export" }],
			todos,
		});

		expect(
			new QueueWork(
				proposal,
				board([
					todo({ id: 1, lane: 3, stage: "queued" }),
					todo({ id: 2, lane: 3, stage: "queued" }),
				]),
			).queued,
		).toBe(true);
		// One let go for a blocker the queue will not start counts as queued.
		expect(
			new QueueWork(
				proposal,
				board([
					todo({ id: 1, lane: 3, stage: "queued" }),
					todo({ id: 2, lane: 3, unqueuedFor: [9] }),
				]),
			).queued,
		).toBe(true);
		expect(
			new QueueWork(
				proposal,
				board([
					todo({ id: 1, lane: 3, stage: "queued" }),
					todo({ id: 2, lane: 3 }),
				]),
			).queued,
		).toBe(false);
		expect(new QueueWork(proposal, { ...board([]), lanes: [] }).gone).toBe(
			true,
		);
	});
});
