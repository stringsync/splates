import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { FakeTimer } from "webappwiz/time/testing";
import { Testing } from "../testing";
import { RunnerServer } from "./runner-server";

const SECRET = "runner-test-bearer";

describe("the idle runner", () => {
	let deps: Testing;
	let timer: FakeTimer;
	let idle: number;
	let server: RunnerServer;

	beforeEach(async () => {
		deps = await Testing.open();
		timer = new FakeTimer();
		idle = 0;
		server = new RunnerServer(new NodePs(), {
			secret: SECRET,
			home: join(deps.root, "idle-runner"),
			port: 0,
			hostname: "127.0.0.1",
			idle: Duration.mins(10),
			onIdle: () => idle++,
			timer,
		});
	});

	afterEach(async () => {
		await server.disposeAsync();
		await deps[Symbol.asyncDispose]();
	});

	it("says it is idle once its idle tail passes with no job", () => {
		expect(timer.timeouts).toHaveLength(1);
		timer.fireTimeouts();
		expect(idle).toBe(1);
	});
});
