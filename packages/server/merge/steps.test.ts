import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeClock } from "webappwiz/time/testing";
import { MergeSteps } from "./steps";

describe("MergeSteps", () => {
	it("keeps each step from when it began, once however often it is entered", () => {
		const clock = new FakeClock(
			Duration.ms(Date.parse("2026-10-26T10:00:00.000Z")),
		);
		const steps = new MergeSteps(clock);

		steps.enter("rebase");
		clock.advance(Duration.secs(1));
		steps.enter("rebase");
		clock.advance(Duration.secs(1));

		expect(steps.enter("wait")).toEqual({
			steps: [
				{ step: "rebase", at: "2026-10-26T10:00:00.000Z" },
				{ step: "wait", at: "2026-10-26T10:00:02.000Z" },
			],
		});
	});

	it("names the file a step prints to, kept once the step under way is given one", () => {
		const steps = new MergeSteps(new FakeClock());
		steps.enter("rebase");

		expect(steps.outputOf("/git", "check")).toBe(
			"/git/splates-merge-1-check.log",
		);
		steps.enter("test");
		expect(steps.outputOf("/git", "test")).toBe(
			"/git/splates-merge-1-test.log",
		);
		expect(
			steps.enter("test", "/git/splates-merge-1-test.log").steps[1]?.output,
		).toBe("/git/splates-merge-1-test.log");
		expect(steps.enter("test", "/other.log").steps[1]?.output).toBe(
			"/git/splates-merge-1-test.log",
		);
	});

	it("keeps the premerge's phases past it, until another premerge starts", () => {
		const steps = new MergeSteps(new FakeClock());
		steps.enter("test");
		steps.phased([{ phase: "biome", ms: 10 }]);

		expect(steps.enter("land").phases).toEqual([{ phase: "biome", ms: 10 }]);
		steps.enter("rebase");
		expect(steps.enter("test").phases).toBeUndefined();
	});

	it("sums each step's time across retests, the one under way up to now", () => {
		const clock = new FakeClock();
		const steps = new MergeSteps(clock);
		steps.enter("rebase");
		clock.advance(Duration.secs(1));
		steps.enter("test");
		clock.advance(Duration.secs(5));
		steps.enter("rebase");
		clock.advance(Duration.secs(2));
		steps.enter("test");
		clock.advance(Duration.secs(3));

		expect(steps.ms).toEqual({ rebase: 3000, test: 8000 });
	});
});
