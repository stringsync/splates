import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodePs } from "webappwiz/system";
import { WorkerRegistry } from "../workers/registry";
import { RunnerServer } from "../workers/runner-server";
import { FlyRunners, RUNNER_ID, RUNNER_SECRET } from "./fly-runners";
import { FLY_SIZES } from "./fly-sizes";
import type { FlySize } from "./fly-types";
import { RunnerGone } from "./runner-gone";
import { FakeAwaitingRunner, FakeFlyCloud } from "./testing";

const SIZE = FLY_SIZES.find(
	(size) => size.name === "shared-cpu-4x-8gb",
) as FlySize;

describe("FlyRunners", () => {
	let fake: FakeFlyCloud;
	let home: string;
	let registry: WorkerRegistry;
	let released: FlyRunners;
	let checkout: FlyRunners;
	let stops: (() => Promise<void>)[];

	beforeEach(async () => {
		fake = new FakeFlyCloud();
		home = await mkdtemp(join(tmpdir(), "fly-runners-"));
		registry = new WorkerRegistry(new MemoryLogger());
		released = new FlyRunners(fake, {
			boot: {
				ownBuild: async () => false,
				image: async () => "ghcr.io/stringsync/splates-runner:1.0.0",
				bundle: async () => new Uint8Array(),
			},
		});
		checkout = new FlyRunners(fake, {
			boot: {
				ownBuild: async () => true,
				image: async () => "ghcr.io/stringsync/splates-runner:latest",
				bundle: async () => new TextEncoder().encode("#!/usr/bin/env bun"),
			},
		});
		stops = [];
	});

	afterEach(async () => {
		registry.dispose();
		await Promise.all(stops.map((stop) => stop()));
		await rm(home, { recursive: true, force: true });
	});

	it("makes a kept runner with a secret, its name and the proxy's service", async () => {
		const made = await released.make("splates-run-one", SIZE, {
			"splates-run": "splates-run-one",
		});
		expect(made.config).toMatchObject({
			image: "ghcr.io/stringsync/splates-runner:1.0.0",
			auto_destroy: false,
			metadata: { "splates-run": "splates-run-one" },
			services: [{ internal_port: 8080, autostart: false }],
		});
		expect(made.config.env[RUNNER_ID]).toBe("splates-run-one");
		expect(made.config.env[RUNNER_SECRET]?.length).toBeGreaterThan(30);
		expect(made.config.init).toBeUndefined();
	});

	// scry-ignore simple-test-setup: the runner's job server needs the secret of the machine this test makes
	it("starts a stopped runner and opens its job channel with its secret", async () => {
		const made = await released.make("splates-run-two", SIZE, {});
		await fake.stop(made.id);
		const runner = new RunnerServer(new NodePs(), {
			secret: made.config.env[RUNNER_SECRET] ?? "",
			id: "splates-run-two",
			home,
			port: 0,
			hostname: "127.0.0.1",
		});
		stops.push(() => runner.disposeAsync());
		fake.address = `http://127.0.0.1:${runner.port}`;
		const socket = await released.reach(made.id);
		const accepted = registry.accept(socket, "provisioned", "splates-run-two");
		socket.send("ready");
		await accepted;
		expect((await fake.machine(made.id))?.state).toBe("started");
		expect(registry.worker("splates-run-two")?.info).toMatchObject({
			jobs: true,
		});
	});

	it("hands a runner made for a checkout its build before dialing it", async () => {
		const made = await checkout.make("splates-run-three", SIZE, {});
		const runner = new FakeAwaitingRunner(made.config.env[RUNNER_SECRET] ?? "");
		stops.push(() => runner.disposeAsync());
		fake.address = runner.address;
		(await checkout.reach(made.id)).dispose();
		expect(new TextDecoder().decode(runner.builds[0])).toBe(
			"#!/usr/bin/env bun",
		);
	});

	it("boots a runner made for a checkout into a bootstrap that parses", async () => {
		const made = await checkout.make("splates-run-four", SIZE, {});
		const program = made.config.init?.entrypoint?.[2] ?? "";
		expect(() =>
			new Bun.Transpiler({ loader: "js" }).transformSync(program),
		).not.toThrow();
	});

	it("refuses to reach a runner whose machine is gone", async () => {
		await expect(released.reach("fly-404")).rejects.toBeInstanceOf(RunnerGone);
	});
});
