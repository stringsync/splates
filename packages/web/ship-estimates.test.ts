import { expect, test } from "bun:test";
import type { RunState } from "@splates/server/ship";
import { shipEstimates, typicalKey } from "./ship-estimates";

test("the typical time of a step is the median of finished runs, leaving out the current one", () => {
	const runs = [
		run("now", "running", 999),
		run("a", "done", 10),
		run("b", "done", 30),
		run("c", "failed", 5000),
		run("d", "done", 20),
	];
	expect(shipEstimates(runs, "now").get(typicalKey("web", "build"))).toBe(20);
});

test("a step no finished run timed has no typical time", () => {
	expect(shipEstimates([run("a", "failed", 10)]).size).toBe(0);
});

function run(id: string, status: RunState["status"], ms: number): RunState {
	return {
		id,
		started: 0,
		status,
		notes: [],
		targets: [
			{
				name: "web",
				command: "ship",
				dependencies: [],
				steps: [
					{
						id: "build",
						does: "Build",
						dependencies: [],
						status: "done",
						output: [],
						prompts: [],
						started: 100,
						ended: 100 + ms,
					},
				],
			},
		],
	};
}
