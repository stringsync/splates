import { describe, expect, it } from "bun:test";
import { type SpendRun, splitSpend } from "./spend";

describe("splitSpend", () => {
	it("gives a worker's hour to the one task that ran on it, idle time and all", () => {
		const shares = splitSpend(
			[life("w", 1, at(10), at(11))],
			[run("a", "w", at(10, 15), at(10, 30))],
			at(0),
			at(12),
		);

		expect(shares).toEqual([
			{
				project: "/p",
				task: "a",
				dollars: 1,
				slotHours: 0.25,
				estimate: true,
			},
		]);
	});

	it("shares an hour among those that ran in it by how long each held its slot", () => {
		const shares = splitSpend(
			[life("w", 1, at(10), at(11))],
			[run("a", "w", at(10), at(10, 30)), run("b", "w", at(10, 45), at(11))],
			at(0),
			at(12),
		);

		expect(shares.map(({ task, dollars }) => [task, dollars])).toEqual([
			["a", 2 / 3],
			["b", 1 / 3],
		]);
	});

	it("counts an hour nothing ran in as idle, with no project or task", () => {
		const shares = splitSpend(
			[life("w", 1, at(10), at(12))],
			[run("a", "w", at(10), at(10, 30))],
			at(0),
			at(13),
		);

		expect(
			shares.map(({ project, task, dollars }) => [project, task, dollars]),
		).toEqual([
			["/p", "a", 1],
			[null, null, 1],
		]);
	});

	it("splits each hour apart, by clock hour, within the window alone", () => {
		const shares = splitSpend(
			[life("w", 2, at(9, 30), null)],
			[run("a", "w", at(9, 30), at(10, 15)), run("b", "w", at(10), null)],
			at(10),
			at(11),
		);

		// From 10:00 the hour is $2: a held 15 minutes of it, b 60.
		expect(shares.map(({ task, dollars }) => [task, dollars])).toEqual([
			["b", 1.6],
			["a", 0.4],
		]);
	});

	it("keeps a project's conversations with no task apart from its tasks", () => {
		const shares = splitSpend(
			[life("w", 1, at(10), at(11))],
			[run(null, "w", at(10), at(11))],
			at(0),
			at(12),
		);

		expect(shares[0]).toMatchObject({ project: "/p", task: null, dollars: 1 });
	});
});

/** 17 October 2026 at `hour`:`minute`, local time. */
function at(hour: number, minute = 0): number {
	return new Date(2026, 9, 17, hour, minute).getTime();
}

function life(
	id: string,
	dollarsPerHour: number,
	from: number,
	until: number | null,
) {
	return { id, dollarsPerHour, from, until };
}

function run(
	task: string | null,
	worker: string,
	from: number,
	until: number | null,
): SpendRun {
	return {
		conversation: `c-${task}`,
		project: "/p",
		task,
		worker,
		from,
		until,
	};
}
