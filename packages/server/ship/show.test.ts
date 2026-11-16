import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { RUNS } from "./engine";
import type { RunEvent } from "./run-events";
import { describeRun, KeptRuns, runLine, stepOutput } from "./show";

const STEP = { target: "lib", step: "publish" };

describe("show", () => {
	it("reads a run from its file and tells its steps, errors and fixes", async () => {
		const storage = new MemoryStorage();
		await storage.log<RunEvent>(`${RUNS}/r1.jsonl`).append(...events);
		const kept = new KeptRuns(storage);
		const [listed] = await kept.list();
		expect(listed?.id).toBe("r1");
		expect(runLine(listed ?? fail())).toBe(
			"r1  failed   1970-01-01T00:00:00.000Z  lib  failed: lib/publish",
		);
		const found = await kept.read("r1");
		expect(found).not.toBeNull();
		const told = describeRun(found?.state ?? fail());
		expect(told).toContain("ship run r1: failed");
		expect(told).toContain("publish  failed    Publish lib");
		expect(told).toContain("error: npm said 403");
		expect(told).toContain("fix: task #7, with an agent");
		expect(told).toContain("retried 1×");
		expect(stepOutput(found?.events ?? [], "lib", "publish")).toBe(
			"second try\n",
		);
		expect(await kept.read("../x")).toBeNull();
	});
});

const events: RunEvent[] = [
	{
		type: "started",
		at: 0,
		targets: [
			{
				name: "lib",
				command: "bin/lib ship",
				bump: "patch",
				dependencies: [],
				steps: [{ id: "publish", does: "Publish lib" }],
			},
		],
	},
	{ type: "checking", at: 1, ...STEP },
	{ type: "output", ...STEP, text: "first try\n" },
	{ type: "ended", at: 2, ...STEP, outcome: "failed", error: "boom" },
	{ type: "retried", at: 3, ...STEP },
	{ type: "checking", at: 4, ...STEP },
	{ type: "output", ...STEP, text: "second try\n" },
	{ type: "ended", at: 5, ...STEP, outcome: "failed", error: "npm said 403" },
	{ type: "sent", at: 6, ...STEP, task: 7 },
];

function fail(): never {
	throw new Error("no run");
}
