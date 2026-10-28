import { describe, expect, it } from "bun:test";
import { SOUND2SCORE_LANES, sound2score } from "./example";
import {
	cycle,
	isSkipped,
	lane,
	lanes,
	mentioned,
	misordered,
	settle,
} from "./lanes";
import type { TaskRecord } from "./task";

describe("lanes", () => {
	it("says a queued lane skips a task only while queued", () => {
		const one = task({ id: 1, lane: 1, position: 1 });
		const queued = [{ id: 1, name: "A", queued: true as const, skip: [1] }];

		expect(isSkipped(queued, one)).toBe(true);
		expect(isSkipped([{ id: 1, name: "A", skip: [1] }], one)).toBe(false);
		expect(isSkipped(queued, task({ id: 2, lane: 1, position: 2 }))).toBe(
			false,
		);
	});

	it("stalls a queued lane whose tasks all wait on one nothing will start", () => {
		const records = [
			{ id: 0, name: "Backlog", queued: true as const, skip: [1] },
		];
		const tasks = [
			task({ id: 1, lane: 0, position: 1, stage: "ready" }),
			task({ id: 2, lane: 0, position: 2, blockedBy: [1] }),
			task({ id: 3, lane: 0, position: 3, blockedBy: [2] }),
			task({ id: 4, lane: 0, position: 4, takenBy: "elsewhere" }),
		];

		expect(lanes(tasks, records)[0]?.stalled).toEqual({
			holdups: [{ id: 1, subject: "a task", lane: 0, why: "skipped" }],
		});
	});

	it("names a blocker in a lane not queued, or in none, as what stalls it", () => {
		const records = [
			{ id: 1, name: "A", queued: true as const },
			{ id: 2, name: "B" },
		];
		const tasks = [
			task({ id: 1, lane: 2, position: 1 }),
			task({ id: 2, lane: null, position: 2 }),
			task({ id: 3, lane: 1, position: 3, blockedBy: [1, 2] }),
		];

		expect(
			lanes(tasks, records)[0]?.stalled?.holdups.map(({ id, why }) => [
				id,
				why,
			]),
		).toEqual([
			[1, "unqueued"],
			[2, "untriaged"],
		]);
	});

	it("leaves a queued lane going while any of its tasks will start", () => {
		const records = [
			{ id: 1, name: "A", queued: true as const, skip: [1] },
			{ id: 2, name: "B", queued: true as const },
		];
		const tasks = [
			task({ id: 1, lane: 1, position: 1 }),
			task({ id: 2, lane: 1, position: 2, blockedBy: [1] }),
			task({ id: 3, lane: 1, position: 3 }),
			task({ id: 4, lane: 2, position: 4, blockedBy: [5] }),
			task({ id: 5, lane: 1, position: 5, stage: "queued" }),
		];

		const [one, two] = lanes(tasks, records);
		expect(one?.stalled).toBeUndefined();
		// Waiting on a queued task is waiting, not stalled.
		expect(two?.stalled).toBeUndefined();
		// Nor is a lane not queued, however blocked.
		expect(
			lanes(tasks, [{ id: 1, name: "A", skip: [1] }])[0]?.stalled,
		).toBeUndefined();
	});

	it("stalls on its own spent budget until more is approved", () => {
		const record = { id: 1, name: "A", queued: true as const, budget: 0 };
		const tasks = [task({ id: 1, lane: 1, stage: "ready" })];

		expect(lane(tasks, record).stalled).toEqual({
			holdups: [{ id: 1, subject: "a task", lane: 1, why: "budget" }],
		});
		expect(lane(tasks, { ...record, budget: 20 }).stalled).toBeUndefined();
	});

	it("is not ready on a lost blocker or one still open in another project", () => {
		const external = { project: "/repos/webappwiz", id: 20, subject: "Events" };
		const record = { id: 1, name: "A" };
		const waiting = task({
			id: 1,
			lane: 1,
			stage: "ready",
			blockedElsewhere: [external],
		});

		expect(lane([waiting], record).ready).toBe(false);
		expect(
			lane(
				[{ ...waiting, blockedElsewhere: [{ ...external, landed: "abc123" }] }],
				record,
			).ready,
		).toBe(true);
		expect(
			lane(
				[{ ...waiting, blockedElsewhere: [{ ...external, lost: true }] }],
				record,
			).ready,
		).toBe(false);
	});

	it("draws the sound2score lanes as they were run", () => {
		const tasks = sound2score();

		expect(shape(tasks)).toEqual([
			[187, 191, 177, 196, 197, 184],
			[200, 209, 186, 208, 189],
			[207, 211, 201, 206, 198],
		]);
		const [one, two, three] = lanes(tasks, SOUND2SCORE_LANES);
		expect(one?.name).toBe("Licensing");
		expect(one?.next?.id).toBe(187);
		expect(one?.ready).toBe(true);
		expect(two?.next?.id).toBe(200);
		expect(three?.blockers).toEqual([]);
	});

	it("says a lane is blocked by another once its next task is blocked by one there", () => {
		const tasks = sound2score().map((each) =>
			[200, 209].includes(each.id) ? { ...each, takenBy: "decoder" } : each,
		);

		const two = lane(tasks, { id: 2, name: "Two" });

		expect(two.next?.id).toBe(186);
		expect(two.ready).toBe(false);
		expect(two.agents).toEqual(["decoder"]);
		expect(two.blockers).toEqual([
			{
				id: 177,
				subject: "Gate score exports by license tier",
				lane: 1,
				takenBy: null,
			},
		]);
	});

	it("finds a loop, naming each task in it in merge order", () => {
		const tasks = sound2score();

		expect(cycle(tasks, 187, 177)).toEqual([187, 191, 177, 187]);
		expect(cycle(tasks, 186, 177)).toBeNull();
		expect(cycle(tasks, 5, 5)).toEqual([5, 5]);
	});

	// scry-ignore simple-test-setup: these five tasks, two lanes and their links are the case it checks, and no other test uses them.
	it("moves a task below what it comes after in its lane, and nothing else", () => {
		const one = task({ id: 1, lane: 1, position: 1, blockedBy: [3] });
		const two = task({ id: 2, lane: 2, position: 2 });
		const three = task({ id: 3, lane: 1, position: 3 });
		const four = task({ id: 4, lane: 2, position: 4, blockedBy: [5] });
		const five = task({ id: 5, lane: null, position: 5 });

		expect(misordered([one, two, three, four, five])).toEqual({
			task: one,
			blockedBy: three,
		});
		// #4 waits on #5 from another lane, which order does not say.
		expect(
			settle([one, two, three, four, five]).map((each) => each.id),
		).toEqual([2, 3, 1, 4, 5]);
	});

	it("reads the tasks a text mentions, but not in code or links", () => {
		expect(
			mentioned(
				"After #187 and #191, see `#3` and page#2.\n\n```\n#4\n```\nAgain #187.",
			),
		).toEqual([187, 191]);
	});

	it("leaves out a task another project's slug names", () => {
		expect(
			mentioned(
				"Waits on webappwiz task #404, Webappwiz#405, #webappwiz #406 and webappwiz #407; then #12, and app #13.",
				["webappwiz", "app-2"],
			),
		).toEqual([12, 13]);
	});
});

function task(overrides: Partial<TaskRecord>): TaskRecord {
	return {
		id: 1,
		subject: "a task",
		text: "",
		position: 1,
		from: null,
		createdAt: new Date().toISOString(),
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		stage: "backlog",
		...overrides,
	};
}

/** Each lane's task ids, top first. */
function shape(tasks: TaskRecord[]): number[][] {
	return lanes(tasks, SOUND2SCORE_LANES).map((found) =>
		found.todos.map((each) => each.id),
	);
}
