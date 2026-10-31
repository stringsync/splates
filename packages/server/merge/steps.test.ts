import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "core/time";
import { FakeClock, FakeWallClock } from "core/time/testing";
import { MergeSteps } from "./steps";

describe("MergeSteps", () => {
	let clock: FakeClock;
	let wall: FakeWallClock;
	let steps: MergeSteps;

	beforeEach(() => {
		clock = new FakeClock();
		wall = new FakeWallClock(Date.parse("2026-10-26T10:00:00.000Z"));
		steps = new MergeSteps(clock, wall);
	});

	it("keeps each step from when it began, once however often it is entered", () => {
		steps.enter("rebase");
		clock.advance(Duration.secs(1));
		wall.advance(Duration.secs(1));
		steps.enter("rebase");
		clock.advance(Duration.secs(1));
		wall.advance(Duration.secs(1));

		expect(steps.enter("wait")).toEqual({
			steps: [
				{ step: "rebase", at: "2026-10-26T10:00:00.000Z" },
				{ step: "wait", at: "2026-10-26T10:00:02.000Z" },
			],
		});
	});

	it("measures elapsed time independently of calendar clock adjustments", () => {
		steps.enter("rebase");
		clock.advance(Duration.secs(2));
		wall.advance(Duration.secs(60));
		steps.enter("test");
		clock.advance(Duration.secs(5));
		wall.set(0);

		expect(steps.progress.steps[1]?.at).toBe("2026-10-26T10:01:00.000Z");
		expect(steps.ms).toEqual({ rebase: 2000, test: 5000 });
	});

	it("names the file a step prints to, kept once the step under way is given one", () => {
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
		steps.enter("test");
		steps.phased([{ phase: "biome", ms: 10 }]);

		expect(steps.enter("land").phases).toEqual([{ phase: "biome", ms: 10 }]);
		steps.enter("rebase");
		expect(steps.enter("test").phases).toBeUndefined();
	});

	it("sums each step's time across retests, the one under way up to now", () => {
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

	it("marks a premerge in a batch that split, waiting again and counting it as waiting", () => {
		steps.enter("rebase");
		clock.advance(Duration.secs(1));
		wall.advance(Duration.secs(1));
		steps.enter("wait");
		clock.advance(Duration.secs(2));
		wall.advance(Duration.secs(2));
		steps.enter("test", "/git/splates-merge-2-test.log");
		clock.advance(Duration.secs(30));
		wall.advance(Duration.secs(30));
		steps.leftBatch();
		clock.advance(Duration.secs(4));
		wall.advance(Duration.secs(4));
		steps.enter("test");
		clock.advance(Duration.secs(10));

		expect(steps.progress.steps).toEqual([
			{ step: "rebase", at: "2026-10-26T10:00:00.000Z" },
			{ step: "wait", at: "2026-10-26T10:00:01.000Z" },
			{
				step: "test",
				at: "2026-10-26T10:00:03.000Z",
				output: "/git/splates-merge-2-test.log",
				dissolved: true,
			},
			{ step: "wait", at: "2026-10-26T10:00:33.000Z" },
			{ step: "test", at: "2026-10-26T10:00:37.000Z" },
		]);
		expect(steps.ms).toEqual({ rebase: 1000, wait: 36_000, test: 10_000 });
	});
});
