import { expect, test } from "bun:test";
import { Duration } from "webappwiz/time";
import { Priority } from "./job";
import { runJob } from "./run";

test("a run is a low job of two cpus and ten minutes, for the task that ran it", () => {
	const env: Record<string, string> = { SPLATES_TASK: "t" };
	const spec = runJob({
		argv: ["bun", "install"],
		ps: { env: (name: string) => env[name] } as never,
	});
	expect(spec).toEqual({
		what: "bun install",
		task: "t",
		priority: Priority.low,
		request: { resources: { cpus: 2 }, walltime: Duration.mins(10) },
	});
});
