import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Replicator } from "@stringsync/splates-server/replica";
import { FakeReplica } from "@stringsync/splates-server/replica/testing";
import { Testing } from "@stringsync/splates-server/testing";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { splates } from "./splates";

describe("splates replica status", () => {
	let env: Testing;
	let deps: Parameters<typeof splates.run>[0];

	beforeEach(async () => {
		env = await Testing.open();
		env.ps.cd(env.root);
		deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
			secrets: env.secrets,
		};
	});

	afterEach(() => env.disposeAsync());

	it("says how to name one when the project has none", async () => {
		await splates.run(deps, ["replica", "status"]);

		expect(env.out()).toContain(
			"no replica: name one as `replica` in splates.config.ts",
		);
	});

	it("prints where the server's replicator last left it, failing included", async () => {
		const replica = new FakeReplica();
		replica.failing = new Error("bucket unreachable");
		const replicator = new Replicator({
			storage: env.storage,
			replica,
			timer: new FakeTimer(),
			clock: new FakeWallClock(),
			log: new MemoryLogger(),
			host: "mac",
		});
		await replicator.start();
		replicator.dispose();

		await splates.run(deps, ["replica", "status"]);

		expect(env.out()).toContain("replica:    fake");
		expect(env.out()).toContain("caught up:  never");
		expect(env.out()).toContain("failing:    bucket unreachable");
	});
});
