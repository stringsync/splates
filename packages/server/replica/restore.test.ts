import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { FORMAT } from "../records";
import { Testing } from "../testing";
import { Replicator, restoreFromReplica } from "./index";
import { FakeReplica } from "./testing";

describe("restoreFromReplica", () => {
	let env: Testing;
	let replica: FakeReplica;
	const restore = (force: boolean) =>
		restoreFromReplica(replica, {
			target: env.records,
			fs: env.fs,
			format: FORMAT,
			force,
		});

	beforeEach(async () => {
		env = await Testing.open();
		replica = new FakeReplica();
		await env.storage.collection("tasks").write("1.md", "first");
		await env.storage.log("log.jsonl").append({ op: "add" });
		await env.storage.log("log.jsonl").append({ op: "merge" });
		await env.storage.document("creds.json").write({ secret: true });
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
	});

	afterEach(() => env.disposeAsync());

	it("refuses records already there", async () => {
		await expect(restore(false)).rejects.toThrow("--force");
	});

	it("brings the records back over the old ones, left aside, and adopts the origin", async () => {
		await env.storage.collection("tasks").write("2.md", "stray");

		const done = await restore(true);

		expect(done.host).toBe("mac");
		expect(done.replaced).toEndWith("state.db.moved");
		const storage = await env.records.open();
		expect(await storage.collection("tasks").read("1.md")).toBe("first");
		expect(await storage.collection("tasks").read("2.md")).toBeNull();
		expect(await storage.log("log.jsonl").replay()).toEqual([
			{ op: "add" },
			{ op: "merge" },
		]);
		// the restored server replicates on rather than refusing the replica
		const again = new Replicator({
			storage,
			replica,
			timer: new FakeTimer(),
			clock: new FakeWallClock(),
			log: new MemoryLogger(),
			host: "droplet",
		});
		await again.start();
		again.dispose();
		expect(again.status().error).toBeNull();
	});

	it("says there is nothing to restore from an empty replica", async () => {
		replica.objects.clear();
		await expect(restore(true)).rejects.toThrow("holds no records yet");
	});
});
