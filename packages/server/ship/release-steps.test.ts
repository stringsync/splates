import { describe, expect, it } from "bun:test";
import { eventsText, readReleaseSteps } from "./release-steps";

const declared = (id: string, stage = "build") => ({
	type: "declared",
	id,
	name: id.toUpperCase(),
	stage,
	packages: [],
	deadlineMs: 5000,
	at: "t0",
});

describe("readReleaseSteps", () => {
	it("folds events by step id", () => {
		const steps = readReleaseSteps(
			eventsText([
				declared("a"),
				declared("b", "publish"),
				declared("c"),
				{ type: "started", id: "a", name: "A", at: "t1" },
				{ type: "check", id: "a", name: "A", passed: true, at: "t2" },
				{ type: "done", id: "a", name: "A", at: "t3" },
				{ type: "skipped", id: "b", name: "B", at: "t4" },
				{ type: "started", id: "c", name: "C", at: "t5" },
			]),
		);
		expect(steps.map((each) => [each.id, each.state, each.stage])).toEqual([
			["a", "done", "build"],
			["b", "skipped", "publish"],
			["c", "running", "build"],
		]);
		expect(steps[0]).toMatchObject({
			started: "t1",
			ended: "t3",
			checked: true,
		});
	});

	it("skips lines it does not know and events for undeclared steps", () => {
		const steps = readReleaseSteps(
			`garbage\n{"type":"mystery","id":"a"}\n${eventsText([
				{ type: "done", id: "ghost", name: "G", at: "t" },
				declared("a"),
			])}{"half`,
		);
		expect(steps.map((each) => each.id)).toEqual(["a"]);
	});

	it("is empty for an empty file", () => {
		expect(readReleaseSteps("")).toEqual([]);
	});
});
