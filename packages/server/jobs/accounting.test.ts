import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { MemoryStorage } from "../storage/testing";
import { Accounting, type JobRun, RUNS_KEPT } from "./accounting";

describe("Accounting", () => {
	let accounting: Accounting;

	beforeEach(() => {
		accounting = new Accounting(new MemoryStorage());
	});

	it("expects a command to take the median of its finished runs", async () => {
		await accounting.record("bun test", run(60_000));
		await accounting.record("bun test", run(20_000));
		await accounting.record("bun test", run(40_000));

		expect(await accounting.expected("bun test")).toEqual(Duration.secs(40));
	});

	it("expects nothing of a command never run, nor from runs that did not finish", async () => {
		await accounting.record("bun test", run(60_000, "expired"));

		expect(await accounting.expected("bun test")).toBeNull();
		expect(await accounting.expected("bun install")).toBeNull();
	});

	it("keeps only the last runs of each command", async () => {
		const slow = Array.from({ length: RUNS_KEPT }, () => run(100_000));
		const fast = Array.from({ length: RUNS_KEPT }, () => run(1000));
		await Promise.all(
			[...slow, ...fast].map((each) => accounting.record("bun test", each)),
		);

		expect(await accounting.expected("bun test")).toEqual(Duration.secs(1));
	});
});

function run(ms: number, outcome: JobRun["outcome"] = "done"): JobRun {
	return {
		at: "2026-10-25T00:00:00.000Z",
		ms,
		allocation: { cpus: 4 },
		outcome,
	};
}
