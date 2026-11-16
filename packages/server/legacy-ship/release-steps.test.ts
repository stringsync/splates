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
	it("reads an adopt request as a question until it is answered", () => {
		const events = [
			declared("adopt", "preflight"),
			{
				type: "adopt",
				id: "adopt",
				name: "Adopt",
				questionId: "q1",
				versions: { mdom: "1.2.0" },
				unmovable: [{ name: "mdom", file: "package.json", pin: "catalog:" }],
				at: "t1",
			},
		];
		expect(readReleaseSteps(eventsText(events))[0]).toMatchObject({
			state: "asking",
			question: { questionId: "q1" },
			adopt: { versions: { mdom: "1.2.0" } },
		});
		const answered = {
			type: "answered",
			id: "adopt",
			name: "Adopt",
			questionId: "q1",
			answer: true,
			at: "t2",
		};
		expect(
			readReleaseSteps(eventsText([...events, answered]))[0],
		).toMatchObject({ state: "running", adopt: null });
	});

	it("clears a question only when its correlated answer arrives", () => {
		const events = [
			declared("a"),
			{
				type: "ask",
				id: "a",
				name: "A",
				questionId: "q1",
				question: "Deploy?",
				at: "t1",
			},
		];
		expect(readReleaseSteps(eventsText(events))[0]).toMatchObject({
			state: "asking",
			question: { questionId: "q1", question: "Deploy?" },
		});
		const answer = {
			type: "answered",
			id: "a",
			name: "A",
			questionId: "other",
			answer: true,
			at: "t2",
		};
		expect(readReleaseSteps(eventsText([...events, answer]))[0]?.state).toBe(
			"asking",
		);
		expect(
			readReleaseSteps(
				eventsText([...events, { ...answer, questionId: "q1" }]),
			)[0],
		).toMatchObject({ state: "running", question: null });
	});

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

	it("keeps the status and link a check reports", () => {
		const [step] = readReleaseSteps(
			eventsText([
				declared("a"),
				{ type: "started", id: "a", name: "A", at: "t1" },
				{
					type: "check",
					id: "a",
					name: "A",
					passed: false,
					status: "in_progress",
					url: "https://github.com/o/r/actions/runs/1",
					at: "t2",
				},
			]),
		);
		expect(step).toMatchObject({
			checked: false,
			status: "in_progress",
			url: "https://github.com/o/r/actions/runs/1",
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
