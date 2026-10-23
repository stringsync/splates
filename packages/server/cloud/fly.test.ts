import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { DEFAULT_JOB_SIZE, runnerSizes } from "../workers";
import {
	FLY_API_TOKEN,
	FlyCloud,
	FlyError,
	type NewFlyMachine,
	TypeRefused,
} from "./index";
import { FakeFlyCloud } from "./testing";

describe("FlyCloud", () => {
	let fake: FakeFlyCloud;
	let cloud: FlyCloud;
	let store: FakeSecretStore;
	let spec: NewFlyMachine;
	beforeEach(async () => {
		fake = new FakeFlyCloud();
		store = new FakeSecretStore();
		await store.set(FLY_API_TOKEN, "fake-token");
		cloud = new FlyCloud({ app: "test-runners", store, fetch: fake.fetch });
		const [size] = runnerSizes(await cloud.sizes(), DEFAULT_JOB_SIZE);
		if (!size) {
			throw new Error("missing default size");
		}
		spec = {
			size,
			region: "ewr",
			image: "test/runner:v1",
			env: { RUNNER_SECRET: "private-value" },
			cmd: ["bun", "serve.ts"],
			metadata: { project: "test", worker: "one" },
			autoDestroy: false,
			persistRootfs: "restart",
			services: [
				{
					protocol: "tcp",
					internal_port: 8080,
					ports: [{ port: 443, handlers: ["tls", "http"] }],
				},
			],
		};
	});

	it("checks the device token without making an app", async () => {
		expect(await cloud.accepted()).toBe(true);
		expect(fake.appExists).toBe(false);
		fake.accepted = false;
		expect(await cloud.accepted()).toBe(false);
		await store.delete(FLY_API_TOKEN);
		expect(await cloud.accepted()).toBe(false);
	});

	it("offers the cheapest size holding the default job and bills by the second", async () => {
		expect(spec.size).toMatchObject({
			preset: "shared-cpu-4x",
			cpus: 4,
			memory: 8,
			billing: "second",
		});
		expect(
			runnerSizes(await cloud.sizes(), { cpus: 16, memory: 128 })[0],
		).toMatchObject({ preset: "performance-16x", memory: 128 });
		expect(runnerSizes(await cloud.sizes(), { cpus: 17, memory: 8 })).toEqual(
			[],
		);
		expect(
			runnerSizes(
				await cloud.sizes(),
				DEFAULT_JOB_SIZE,
				(name) => name === spec.size.name,
			)[0]?.name,
		).not.toBe(spec.size.name);
	});

	it("creates the app and proxy addresses once, using Fly's native machine config", async () => {
		const first = await cloud.create(spec);
		await cloud.create({ ...spec, metadata: { worker: "two" } });
		expect(fake.ips).toEqual(new Set(["shared_v4", "v6"]));
		expect(
			fake.requests.filter(
				(request) => request.path === "/v1/apps" && request.method === "POST",
			),
		).toHaveLength(1);
		expect(
			fake.requests.filter((request) => request.path === "/graphql"),
		).toHaveLength(3);
		expect(first.config).toMatchObject({
			guest: {
				cpu_kind: "shared",
				cpus: 4,
				memory_mb: 8192,
				persist_rootfs: "restart",
			},
			init: { cmd: ["bun", "serve.ts"] },
			env: spec.env,
			services: spec.services,
			auto_destroy: false,
		});
	});

	it("uses existing app addresses with an app-scoped token", async () => {
		fake.appExists = true;
		fake.ips.add("shared_v4");
		fake.ips.add("v6");
		await cloud.create(spec);
		expect(
			fake.requests.filter((request) => request.path === "/graphql"),
		).toHaveLength(1);
		expect(
			fake.requests.filter((request) => request.path === "/v1/apps"),
		).toHaveLength(0);
	});

	it("finds machines by every metadata value and waits at most 60 seconds", async () => {
		const first = await cloud.create(spec);
		await cloud.create({
			...spec,
			metadata: { project: "other", worker: "two" },
		});
		expect(
			(await cloud.list({ project: "test", worker: "one" })).map(
				(machine) => machine.id,
			),
		).toEqual([first.id]);
		await cloud.wait(first.id, "started");
		expect(fake.requests.at(-1)?.path).toContain("state=started&timeout=60");
	});

	it("keeps files for a warm restart and exposes stopped and started states", async () => {
		const machine = await cloud.create(spec);
		fake.files.get(machine.id)?.set("clone", "cached");
		await cloud.stop(machine.id);
		expect((await cloud.machine(machine.id))?.state).toBe("stopped");
		await cloud.start(machine.id);
		expect((await cloud.machine(machine.id))?.state).toBe("started");
		expect(fake.files.get(machine.id)?.get("clone")).toBe("cached");
	});

	it("resets rootfs without persistence and destroys an auto-destroy machine on stop", async () => {
		const reset = await cloud.create({ ...spec, persistRootfs: "never" });
		fake.files.get(reset.id)?.set("clone", "cached");
		await cloud.stop(reset.id);
		await cloud.start(reset.id);
		expect(fake.files.get(reset.id)?.size).toBe(0);
		const disposable = await cloud.create({ ...spec, autoDestroy: true });
		await cloud.stop(disposable.id);
		expect(await cloud.machine(disposable.id)).toBeNull();
		await cloud.destroy(disposable.id);
		expect(await cloud.list()).toHaveLength(1);
	});

	it("lets lifecycle tests observe intermediate states", async () => {
		fake.autoAdvance = false;
		const machine = await fake.create(spec);
		expect(machine.state).toBe("starting");
		await fake.wait(machine.id, "started");
		await fake.stop(machine.id);
		expect((await fake.machine(machine.id))?.state).toBe("stopping");
		await fake.wait(machine.id, "stopped");
		expect(fake.history.map((entry) => entry.state)).toEqual([
			"created",
			"starting",
			"started",
			"stopping",
			"stopped",
		]);
	});

	it("turns capacity and size refusals into TypeRefused and keeps authentication errors distinct", async () => {
		fake.refused.add(spec.size.name);
		await expect(cloud.create(spec)).rejects.toBeInstanceOf(TypeRefused);
		fake.accepted = false;
		await expect(cloud.create(spec)).rejects.toBeInstanceOf(FlyError);
	});

	it("redacts credentials from a refusal that echoes machine env", async () => {
		await cloud.create(spec);
		fake.failure = {
			status: 422,
			reason: "invalid size: private-value fake-token",
		};
		await expect(cloud.create(spec)).rejects.toThrow("[redacted] [redacted]");
	});

	it("retries app initialization after a failed first use", async () => {
		fake.failure = { status: 503, reason: "temporary outage" };
		await expect(cloud.create(spec)).rejects.toBeInstanceOf(FlyError);
		fake.failure = undefined;
		expect((await cloud.create(spec)).state).toBe("started");
	});
});
