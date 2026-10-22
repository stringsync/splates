import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { MemoryStorage, rotated } from "../storage/testing";
import { Replicator } from "./replicator";
import { FakeReplica } from "./testing";

describe("Replicator", () => {
	it("ships every value and log on start, and takes the replica with a manifest", async () => {
		const { storage, replica, replicator } = replicating();
		await storage.collection("tasks").write("1.md", "first");
		await storage.log("log.jsonl").append({ n: 1 }, { n: 2 });

		await replicator.start();

		expect(copied(replica)).toEqual({
			"log.jsonl": '{"n":1}\n{"n":2}\n',
			"tasks/1.md": "first",
		});
		expect(JSON.parse(replica.peek("manifest.json") ?? "")).toMatchObject({
			version: 1,
			host: "mac",
			caughtUpAt: 1_000,
		});
		expect(replicator.status()).toMatchObject({
			pending: 0,
			behindSince: null,
			error: null,
		});
	});

	it("records where it stands, for a process without it to read", async () => {
		const { storage, replica, replicator } = replicating();
		replica.failing = new Error("bucket unreachable");

		await replicator.start();

		expect(await Replicator.recorded(storage)).toEqual({
			replica: "fake",
			caughtUpAt: null,
			pending: 0,
			behindSince: null,
			error: "bucket unreachable",
		});
	});

	it("gathers the changes of a few seconds into one batch", async () => {
		const { storage, replica, timer, clock, replicator } = replicating();
		await replicator.start();
		replica.calls.length = 0;
		clock.advance(Duration.secs(10));

		await storage.collection("tasks").write("1.md", "first");
		await storage.collection("tasks").write("2.md", "second");

		expect(replica.calls).toEqual([]);
		expect(due(timer).map((delay) => delay.ms)).toEqual([3_000]);
		expect(replicator.status()).toMatchObject({
			pending: 2,
			behindSince: 11_000,
		});
	});

	it("ships a batch once it is due", async () => {
		const { storage, replica, timer, replicator } = replicating();
		await replicator.start();
		await storage.collection("tasks").write("1.md", "first");

		timer.fireTimeouts();
		await replicator.flush();

		expect(copied(replica)).toEqual({ "tasks/1.md": "first" });
	});

	it("ships only a log's new lines, as a chunk of their own", async () => {
		const { storage, replica, replicator } = replicating();
		const log = storage.log("conversations/a.jsonl");
		await log.append({ n: 1 });
		await replicator.start();

		await log.append({ n: 2 }, { n: 3 });
		await replicator.flush();

		const chunks = [...replica.objects.keys()].filter((key) =>
			key.startsWith("logs/"),
		);
		expect(chunks.map((key) => key.split("/").at(-1)?.slice(0, 10))).toEqual([
			"0000000001",
			"0000000003",
		]);
		expect(copied(replica)["conversations/a.jsonl"]).toBe(
			'{"n":1}\n{"n":2}\n{"n":3}\n',
		);
	});

	it("ships a rotated log again from its first line, and its segment whole", async () => {
		const { storage, replica, replicator } = replicating();
		const log = storage.log("log.jsonl");
		await log.append({ n: 1 }, { n: 2 });
		await replicator.start();

		await rotated(log);
		await log.append({ n: 3 }, { n: 4 }, { n: 5 });
		await replicator.flush();

		const shipped = copied(replica);
		expect(shipped["log.jsonl"]).toBe('{"n":3}\n{"n":4}\n{"n":5}\n');
		expect(
			Object.entries(shipped)
				.filter(([key]) => key.startsWith("log.jsonl.segments/"))
				.map(([, text]) => text),
		).toEqual(['{"n":1}\n{"n":2}\n']);
	});

	it("removes from the replica what the storage no longer holds", async () => {
		const { storage, replica, replicator } = replicating();
		await storage.collection("tasks").write("1.md", "first");
		await storage.log("conversations/a.jsonl").append({ n: 1 });
		await replicator.start();

		await storage.remove("tasks");
		await storage.log("conversations/a.jsonl").remove();
		await replicator.flush();

		expect([...replica.objects.keys()]).toEqual(["manifest.json"]);
	});

	it("never ships creds.json or a lock", async () => {
		const { storage, replica, replicator } = replicating();
		await storage.document("creds.json").write({ requests: [] });
		await storage.collection("tasks").write("1.md.lock", "123");
		await replicator.start();

		await storage.document("creds.json").write({ requests: [1] });
		await replicator.flush();

		expect(Object.keys(copied(replica))).toEqual([]);
	});

	it("catches up on start with what changed while it was stopped, shipping only that", async () => {
		const storage = new MemoryStorage();
		const replica = new FakeReplica();
		const first = replicating(storage, replica).replicator;
		await storage.collection("tasks").write("1.md", "first");
		await storage.collection("tasks").write("2.md", "second");
		await storage.log("log.jsonl").append({ n: 1 });
		await first.start();
		first.dispose();
		await storage.collection("tasks").write("2.md", "changed");
		await storage.collection("tasks").remove("1.md");
		await storage.log("log.jsonl").append({ n: 2 });
		replica.calls.length = 0;

		await replicating(storage, replica).replicator.start();

		expect(copied(replica)).toEqual({
			"log.jsonl": '{"n":1}\n{"n":2}\n',
			"tasks/2.md": "changed",
		});
		expect(replica.calls.filter((call) => !call.startsWith("list"))).toEqual([
			expect.stringMatching(/^put logs\/log\.jsonl\/0000000002-/),
			"delete values/tasks/1.md",
			"put values/tasks/2.md",
			"put manifest.json",
		]);
	});

	it("refuses a replica another server began, and ships nothing to it", async () => {
		const replica = new FakeReplica();
		await replicating(new MemoryStorage(), replica).replicator.start();
		const other = new MemoryStorage();
		await other.collection("tasks").write("1.md", "theirs");
		replica.calls.length = 0;
		const { replicator } = replicating(other, replica);

		await replicator.start();

		expect(replica.calls).toEqual([]);
		expect(replicator.status().error).toContain(
			"fake holds the records of another server, last caught up on mac",
		);
	});

	it("keeps what failed to ship, says why, and ships it once the replica is back", async () => {
		const { storage, replica, timer, replicator } = replicating();
		await replicator.start();
		replica.failing = new Error("bucket unreachable");
		await storage.collection("tasks").write("1.md", "first");

		await replicator.flush();

		expect(replicator.status()).toMatchObject({
			pending: 1,
			error: "bucket unreachable",
		});
		expect(due(timer).map((delay) => delay.ms)).toEqual([6_000]);
		replica.failing = null;
		await replicator.flush();
		expect(copied(replica)).toEqual({ "tasks/1.md": "first" });
		expect(replicator.status()).toMatchObject({ pending: 0, error: null });
	});

	it("tries again to catch up when the replica cannot be reached on start", async () => {
		const { storage, replica, replicator } = replicating();
		await storage.collection("tasks").write("1.md", "first");
		replica.failing = new Error("bucket unreachable");

		await replicator.start();
		replica.failing = null;
		await replicator.flush();

		expect(copied(replica)).toEqual({ "tasks/1.md": "first" });
	});

	it("tries again at once when a cred is saved while it is failing", async () => {
		const { storage, replica, timer, replicator } = replicating();
		await storage.collection("tasks").write("1.md", "first");
		replica.failing = new Error(
			"no REPLICA_ACCESS_KEY and REPLICA_SECRET_KEY yet",
		);
		await replicator.start();
		replica.failing = null;

		await storage.document("creds.json").write({ requests: [] });
		// The retry runs on its own; the backoff's timer is never fired.
		await Bun.sleep(10);

		expect(copied(replica)).toEqual({ "tasks/1.md": "first" });
		expect(replicator.status()).toMatchObject({ error: null });
		expect(due(timer)).toEqual([]);
	});
});

function replicating(
	storage = new MemoryStorage(),
	replica = new FakeReplica(),
) {
	const timer = new FakeTimer();
	const clock = new FakeWallClock(1_000);
	const replicator = new Replicator({
		storage,
		replica,
		timer,
		clock,
		log: new MemoryLogger(),
		host: "mac",
	});
	return { storage, replica, timer, clock, replicator };
}

/** What the replica holds, as the storage keys it copies: each value's text, each log's lines joined. */
function copied(replica: FakeReplica): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of [...replica.objects.keys()].sort()) {
		const text = replica.peek(key) ?? "";
		const log = key.match(/^logs\/(.+)\/\d{10}-[0-9a-f]{12}\.jsonl$/)?.[1];
		if (key.startsWith("values/")) {
			out[key.slice("values/".length)] = text;
		} else if (log !== undefined) {
			out[log] = (out[log] ?? "") + text;
		}
	}
	return out;
}

function due(timer: FakeTimer): Duration[] {
	return timer.timeouts
		.filter((entry) => !entry.disposed)
		.map((entry) => entry.delay);
}
