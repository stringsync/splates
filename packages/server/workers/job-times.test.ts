import { describe, expect, it } from "bun:test";
import type { HeldJob } from "./job-pool";
import { JOB_TIMES_KEPT, JobTimes } from "./job-times";

const held = (what: string, since = 0, project = "/a"): HeldJob => ({
	id: "j",
	project,
	task: null,
	what,
	size: { cpus: 4, memory: 8 },
	runner: "r1",
	since,
});

describe("job times", () => {
	it("expects a job to take the median of its command's last runs, from the ledger and as jobs end", () => {
		const times = new JobTimes();
		times.learn([
			{
				row: "job",
				id: "a",
				runner: "r1",
				project: "/a",
				task: null,
				what: "bun test",
				at: new Date(0).toISOString(),
				until: new Date(60_000).toISOString(),
			},
		]);
		times.ended({ ...held("bun test"), until: 100_000 });
		times.ended({ ...held("bun test"), until: 120_000 });

		expect(times.end(held("bun test", 1_000))).toBe(101_000);
	});

	it("falls back to the project's jobs, and knows nothing of another project", () => {
		const times = new JobTimes();
		times.ended({ ...held("bun test"), until: 30_000 });

		expect(times.end(held("bun run build", 0))).toBe(30_000);
		expect(times.end(held("bun test", 0, "/b"))).toBeNull();
	});

	it("keeps only the last runs of a command", () => {
		const times = new JobTimes();
		times.ended({ ...held("x"), until: 1_000_000 });
		times.learn(
			Array.from({ length: JOB_TIMES_KEPT }, (_, at) => ({
				row: "job" as const,
				id: `x${at}`,
				runner: "r1",
				project: "/a",
				task: null,
				what: "x",
				at: new Date(0).toISOString(),
				until: new Date(10).toISOString(),
			})),
		);

		expect(times.end(held("x"))).toBe(10);
	});
});
