import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { Duration, SystemTimer, SystemWallClock } from "webappwiz/time";
import { SqliteStorage } from "../storage";
import { DirReplica, Replicator } from "./index";

// The server's records are a SQLite database every process on the machine
// writes, so the replicator must hear a CLI's writes through the database.
describe("Replicator over a SQLite database", () => {
	let dir: string;
	let server: SqliteStorage;
	let cli: SqliteStorage;
	let replicator: Replicator;
	beforeEach(async () => {
		dir = await realpath(await mkdtemp(join(tmpdir(), "splates-replica-")));
		const open = () =>
			SqliteStorage.open(`${dir}/state.db`, {
				fs: new NodeFs(),
				ps: new FakePs(),
				pollMs: 10,
			});
		server = open();
		cli = open();
		replicator = new Replicator({
			storage: server,
			replica: new DirReplica(`${dir}/replica`, new NodeFs()),
			timer: new SystemTimer(),
			clock: new SystemWallClock(),
			log: new MemoryLogger(),
			host: "mac",
			batch: Duration.ms(20),
		});
	});
	afterEach(async () => {
		replicator.dispose();
		server.dispose();
		cli.dispose();
		await rm(dir, { recursive: true, force: true });
	});

	it("ships what another process writes, a batch later", async () => {
		await replicator.start();

		await cli.collection("tasks").write("1.md", "from the cli");
		await cli.log("log.jsonl").append({ op: "add" });

		const replica = new DirReplica(`${dir}/replica`, new NodeFs());
		const shipped = async () =>
			(await replica.list("")).map((object) => `${object.key} ${object.size}`);
		// scry-ignore matchers-over-test-logic: the poll of the database and the batch run on real timers, so the test waits for them to land
		for (let i = 0; i < 200 && (await shipped()).length < 3; i++) {
			await Bun.sleep(10);
		}

		expect(await shipped()).toEqual([
			expect.stringMatching(
				/^logs\/log\.jsonl\/0000000001-[0-9a-f]{12}\.jsonl 13$/,
			),
			expect.stringMatching(/^manifest\.json /),
			"values/tasks/1.md 12",
		]);
	});
});
