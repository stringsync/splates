import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { DirectBoard } from "./direct-board";
import type {
	DirectJobReport,
	DirectRunnerReport,
} from "./direct-runner-report";

describe("DirectBoard", () => {
	it("lists each job under its runner, and one with no runner apart", () => {
		const board = new DirectBoard({ wall: new FakeWallClock() });
		board.report({ runners: [runner] });
		board.report({ job: job("one") });
		board.report({ job: job("two", { runner: null, phase: "placing" }) });

		expect(board.view()).toEqual({
			runners: [{ ...runner, jobs: [job("one")] }],
			unplaced: [job("two", { runner: null, phase: "placing" })],
		});
	});

	it("drops a runner reported deleted, a job going on unheard 3 minutes, and one ended after 15", () => {
		const wall = new FakeWallClock();
		const board = new DirectBoard({ wall });
		board.report({ runners: [runner] });
		board.report({ job: job("going") });
		board.report({ job: job("ended", { phase: "done", code: 0 }) });
		wall.advance(Duration.mins(4));

		expect(board.view().runners[0]?.jobs.map((each) => each.id)).toEqual([
			"ended",
		]);

		wall.advance(Duration.mins(12));
		board.report({ runners: [{ ...runner, state: "deleted" }] });

		expect(board.view()).toEqual({ runners: [], unplaced: [] });
	});
});

const runner: DirectRunnerReport = {
	id: "splates-run-1",
	type: "s-4vcpu-8gb",
	cpus: 4,
	memory: 8,
	dollarsPerHour: 0.07,
	address: "10.0.0.1",
	state: "up",
	createdAt: 0,
};

function job(
	id: string,
	patch: Partial<DirectJobReport> = {},
): DirectJobReport {
	return {
		id,
		runner: runner.id,
		project: "/repo/.git",
		task: null,
		what: "bun test",
		phase: "running",
		code: null,
		reason: null,
		since: 0,
		...patch,
	};
}
