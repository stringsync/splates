import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import type { WorkerSpec } from "../workers";
import { TypeRefused } from "../workers";
import { FLY_API_TOKEN, FlyCloud, FlyWorkers } from "./index";
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
			{ wall },
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

	it("boots a dial-in worker with credentials in env and runnable JavaScript", async () => {
		await workers.create(spec);
		const [machine] = await fake.list();
		expect(machine?.config.env.SPLATES_JOIN_TOKEN).toBe("private-value");
		const script = machine?.config.init?.cmd[2] ?? "";
		expect(script).not.toContain("private-value");
		const boot = script.slice(
			script.lastIndexOf("exec bun -e '") + "exec bun -e '".length,
			-1,
		);
		expect(() =>
			new Bun.Transpiler({ loader: "js" }).transformSync(boot),
		).not.toThrow();
		expect(await workers.list()).toEqual([
			{ id: "worker-one", type: spec.type },
		]);
		await workers.create(spec);
		expect(await fake.list()).toHaveLength(1);
		await workers.destroy(spec.id);
		expect(await workers.list()).toEqual([]);
	});

	it("leaves refused sizes out for an hour and then tries them again", async () => {
		fake.refused.add(spec.type);
		await expect(workers.create(spec)).rejects.toBeInstanceOf(TypeRefused);
		expect((await workers.types())[0]?.name).not.toBe(spec.type);
		wall.advance(Duration.hrs(1));
		expect((await workers.types())[0]?.name).toBe(spec.type);
	});
});
