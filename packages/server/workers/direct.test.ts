import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { FLY_SIZES, FlyRunners, type FlySize } from "../cloud";
import { RUNNER_SECRET } from "../cloud/fly-runners";
import { FakeFlyCloud } from "../cloud/testing";
import { Testing } from "../testing";
import { WorkerBudget } from "./budget";
import { DIRECT_TAG, DirectRunners } from "./direct";
import { JobSnapshot } from "./job-snapshot";
import { NoRunner } from "./no-runner";
import { RunnerServer } from "./runner-server";

const SIZE = FLY_SIZES.find(
	(size) => size.name === "shared-cpu-4x-8gb",
) as FlySize;

describe("DirectRunners", () => {
	let deps: Testing;
	let fake: FakeFlyCloud;
	let wall: FakeWallClock;
	let budget: WorkerBudget;
	let server: RunnerServer | null;
	let made: FlyRunners;

	beforeEach(async () => {
		deps = await Testing.open();
		fake = new FakeFlyCloud();
		wall = new FakeWallClock(Date.parse("2026-01-01T00:00:00.000Z"));
		budget = WorkerBudget.memory(wall);
		server = null;
		made = new FlyRunners(fake, {
			boot: {
				ownBuild: async () => false,
				image: async () => "ghcr.io/stringsync/splates-runner:1.0.0",
				bundle: async () => new Uint8Array(),
			},
		});
	});

	afterEach(async () => {
		await server?.disposeAsync();
		await deps[Symbol.asyncDispose]();
	});

	// scry-ignore simple-test-setup: only this case serves a runner; its secret is the machine's, known once it is made
	it("runs a job on a runner with room, through the runner's job server", async () => {
		const machine = await made.make("splates-run-one", SIZE, {
			[DIRECT_TAG]: "splates-run-one",
		});
		server = new RunnerServer(new NodePs(), {
			secret: machine.config.env[RUNNER_SECRET] ?? "",
			id: "splates-run-one",
			home: join(deps.root, "runner"),
			port: 0,
			hostname: "127.0.0.1",
		});
		fake.address = `http://127.0.0.1:${server.port}`;
		const runners = new DirectRunners({
			runners: made,
			budget: async () => budget,
			ledger: null,
			snapshot: new JobSnapshot(deps.git),
			lock: {
				acquire: async () => {},
				release: async () => {},
				releaseIfOurs: async () => {},
			},
			claims: join(deps.root, "claims.json"),
			ps: new NodePs(),
			log: new MemoryLogger(),
			wall,
		});
		const output: Uint8Array[] = [];
		const ran = await runners.run({
			project: deps.root,
			cwd: deps.root,
			commit: await new JobSnapshot(deps.git).take(deps.root),
			size: { cpus: 4, memory: 8 },
			argv: ["sh", "-c", "printf direct-ok"],
			env: {},
			prepare: null,
			timeout: null,
			files: [],
			task: null,
			output: (bytes) => output.push(bytes),
		});
		expect(ran.code).toBe(0);
		expect(Buffer.concat(output).toString()).toBe("direct-ok");
		expect(await fake.list()).toHaveLength(1);
		// Nothing deletes it by time; it stops itself, and then costs no more by the hour.
		expect(budget.running()).toEqual(["splates-run-one"]);
		wall.advance(Duration.mins(11));
		expect(await runners.settle()).toEqual([]);
		await fake.stop(machine.id);
		expect(await runners.settle()).toEqual(["splates-run-one"]);
		expect(budget.running()).toEqual([]);
		expect(await fake.list()).toHaveLength(1);
	}, 15000);

	it("refuses a job when the budget allows no runner and none is up", async () => {
		await budget.setRunners(0);
		const runners = new DirectRunners({
			runners: made,
			budget: async () => budget,
			ledger: null,
			snapshot: new JobSnapshot(deps.git),
			lock: {
				acquire: async () => {},
				release: async () => {},
				releaseIfOurs: async () => {},
			},
			claims: join(deps.root, "claims.json"),
			ps: new NodePs(),
			log: new MemoryLogger(),
			wall,
		});
		await expect(
			runners.run({
				project: deps.root,
				cwd: deps.root,
				commit: "0".repeat(40),
				size: { cpus: 4, memory: 8 },
				argv: ["true"],
				env: {},
				prepare: null,
				timeout: null,
				files: [],
				task: null,
				output: () => {},
			}),
		).rejects.toBeInstanceOf(NoRunner);
		expect(await fake.list()).toEqual([]);
	});
});
