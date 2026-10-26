import { describe, expect, it } from "bun:test";
import { Priority } from "@stringsync/splates-server/jobs";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { scheduled } from "./job";

const spec = {
	what: "splates dev test",
	priority: Priority.low,
	request: { resources: { cpus: 1 }, walltime: Duration.mins(1) },
};

function run(env: Record<string, string>, unscheduled = false) {
	const ps = new FakePs();
	ps.setEnv(env);
	return scheduled({
		ps,
		log: new MemoryLogger(),
		spec,
		unscheduled,
		run: async ({ cpus }) => cpus,
	});
}

describe("scheduled", () => {
	it("runs at once with no server named", async () => {
		expect(await run({})).toBeUndefined();
	});

	it("runs at once when the server named does not answer", async () => {
		expect(await run({ SPLATES_DEV: "http://127.0.0.1:1" })).toBeUndefined();
	});

	it("does not ask the server inside a gate or when the caller holds the machine", async () => {
		const env = { SPLATES_DEV: "http://127.0.0.1:1" };
		expect(await run({ ...env, SPLATES_PREMERGE: "1" })).toBeUndefined();
		expect(await run(env, true)).toBeUndefined();
	});
});
