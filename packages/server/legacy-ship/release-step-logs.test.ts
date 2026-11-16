import { describe, expect, it } from "bun:test";
import { type ReleaseStep, withLogs } from "./release-steps";

describe("withLogs", () => {
	const at = (ms: number) => new Date(ms).toISOString();
	const step = (
		id: string,
		started: number | null,
		ended: number | null,
	): ReleaseStep => ({
		id,
		name: id,
		stage: "build",
		packages: [],
		state: ended !== null ? "done" : started !== null ? "running" : "pending",
		started: started === null ? null : at(started),
		ended: ended === null ? null : at(ended),
		deadlineMs: 1000,
		checked: null,
		status: null,
		url: null,
		error: null,
		staged: [],
	});
	// Output came at 100 (to byte 10), 200 (20), 300 (30) and 400 (40), after 5 bytes of the cascade's own.
	const marks = [
		{ at: 100, to: 10 },
		{ at: 200, to: 20 },
		{ at: 300, to: 30 },
		{ at: 400, to: 40 },
	];

	it("gives each step what came between its start and its end", () => {
		const steps = withLogs(
			[step("a", 150, 250), step("b", 250, null), step("c", null, null)],
			marks,
			5,
		);
		expect(steps.map((each) => each.log)).toEqual([
			{ from: 10, to: 20 },
			{ from: 20, to: null },
			undefined,
		]);
	});

	it("starts a step begun before any output where the ship's output began", () => {
		expect(withLogs([step("a", 50, 100)], marks, 5)[0]?.log).toEqual({
			from: 5,
			to: 10,
		});
	});

	it("keeps a slice it closed before, which a restart has no marks for", () => {
		const kept = new Map([["a", { from: 1, to: 3 }]]);
		expect(withLogs([step("a", 150, 250)], [], 50, kept)[0]?.log).toEqual({
			from: 1,
			to: 3,
		});
	});
});
