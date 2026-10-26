import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { gateJob } from "./gate";
import { Priority } from "./job";

describe("gateJob", () => {
	it("asks for the suite and between half the cores and all but two, at high priority for a gate's time", () => {
		const job = gateJob({ what: "premerge", cores: 16, timeoutMs: 180_000 });

		expect(job.priority).toBe(Priority.high);
		expect(job.request).toEqual({
			resources: { cpus: { min: 8, max: 14 }, suite: 1 },
			walltime: Duration.mins(3),
		});
	});

	it("never asks for fewer than half the cores, on a small machine", () => {
		expect(gateJob({ what: "premerge", cores: 4 }).request.resources).toEqual({
			cpus: { min: 2, max: 2 },
			suite: 1,
		});
	});
});
