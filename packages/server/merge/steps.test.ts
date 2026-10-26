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

	it("keeps the premerge's phases past it, until another premerge starts", () => {
		const steps = new MergeSteps(new FakeClock());
		steps.enter("test");
		steps.phased([{ phase: "biome", ms: 10 }]);

		expect(steps.enter("land").phases).toEqual([{ phase: "biome", ms: 10 }]);
		steps.enter("rebase");
		expect(steps.enter("test").phases).toBeUndefined();
	});
});
