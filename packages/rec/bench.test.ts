import { expect, test } from "bun:test";
import { summarizeCpu } from "./bench";

test("summarizeCpu reports CPU alone for a run that records nothing", () => {
	const report = summarizeCpu(
		{ at: 0, controlTask: 0, processes: [{ id: 1, type: "GPU", cpuTime: 1 }] },
		{
			at: 10_000,
			controlTask: 0.5,
			processes: [{ id: 1, type: "GPU", cpuTime: 3 }],
		},
	);
	expect(report).toEqual({
		wallSecs: 10,
		cpu: { controlMainThreadPct: 5, byProcessType: { GPU: 20 } },
	});
});
