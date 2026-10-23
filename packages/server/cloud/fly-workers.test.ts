import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import type { WorkerSpec } from "../workers";
import { TypeRefused } from "../workers";
import { FLY_API_TOKEN, FlyCloud, FlyWorkers } from "./index";
import { RunnerGone } from "./runner-gone";
import { FakeFlyCloud } from "./testing";

describe("FlyWorkers", () => {
	let fake: FakeFlyCloud;
	let workers: FlyWorkers;
	let wall: FakeWallClock;
	let spec: WorkerSpec;
	beforeEach(async () => {
		fake = new FakeFlyCloud();
		const store = new FakeSecretStore();
		await store.set(FLY_API_TOKEN, "token");
		wall = new FakeWallClock();
		workers = new FlyWorkers(
			new FlyCloud({ app: "test-runners", fetch: fake.fetch, store }),
			{
				wall,
				boot: {
					ownBuild: async () => false,
					image: async () => "ghcr.io/stringsync/splates-runner:1.0.0",
					bundle: async () => new Uint8Array(),
					binary: async () => ({
						url: "https://example.test/splates-linux-x64",
						sha256: "a".repeat(64),
					}),
				},
			},
		);
		spec = {
			id: "worker-one",
			type: "shared-cpu-4x-8gb",
			snapshot: null,
			recipe: "#!/bin/sh\nset -eu\n# install tools",
			join: ["splates", "worker", "join"],
			joinEnv: { SPLATES_JOIN_TOKEN: "private-value" },
			boot: ["splates", "worker", "boot"],
		};
	});

	it("offers job sizes without making snapshots or contacting the account", async () => {
		expect((await workers.types())[0]).toMatchObject({
			name: spec.type,
			cpus: 4,
			memory: 8,
			billing: "second",
		});
		expect(fake.requests).toEqual([]);
	});

	it("makes a runner from the image with no join token, once, and destroys it", async () => {
		await workers.create(spec);
		const [machine] = await fake.list();
		expect(machine?.config.image).toBe(
			"ghcr.io/stringsync/splates-runner:1.0.0",
		);
		expect(JSON.stringify(machine?.config)).not.toContain("private-value");
		expect(await workers.list()).toEqual([
			{ id: "worker-one", type: spec.type },
		]);
		await workers.create(spec);
		expect(await fake.list()).toHaveLength(1);
		await workers.destroy(spec.id);
		expect(await workers.list()).toEqual([]);
	});

	it("says a runner whose machine is gone is gone", async () => {
		await expect(workers.reach("worker-none")).rejects.toBeInstanceOf(
			RunnerGone,
		);
	});

	it("leaves refused sizes out for an hour and then tries them again", async () => {
		fake.refused.add(spec.type);
		await expect(workers.create(spec)).rejects.toBeInstanceOf(TypeRefused);
		expect((await workers.types())[0]?.name).not.toBe(spec.type);
		wall.advance(Duration.hrs(1));
		expect((await workers.types())[0]?.name).toBe(spec.type);
	});
});
