import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { UPDATE } from "./protocol";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import type { WorkerKind } from "./remote";
import { WorkerRollout } from "./rollout";
import { WorkerSession } from "./session";
import { WorkerSocketPair } from "./testing";

describe("WorkerRollout", () => {
	let timer: FakeTimer;
	let clock: FakeClock;
	let log: MemoryLogger;
	let registry: WorkerRegistry;
	let records: WorkerRecords;
	/** The agents on each worker, by its id. */
	let used: Map<string, string[]>;
	/** The builds each worker was asked to restart on, by its id. */
	let told: Map<string, string[]>;
	let rollout: WorkerRollout | undefined;
	const sessions: WorkerSession[] = [];

	beforeEach(() => {
		timer = new FakeTimer();
		clock = new FakeClock();
		log = new MemoryLogger();
		registry = new WorkerRegistry(log, { timer, clock });
		records = WorkerRecords.memory();
		used = new Map();
		told = new Map();
	});

	/** Starts the rollout over the workers joined so far, as a server does as it comes up. */
	function start(): WorkerRollout {
		rollout = new WorkerRollout({
			registry,
			records,
			build: "2.0.0",
			used: () => used,
			pooled: () => true,
			poke: () => {},
			log,
		});
		return rollout;
	}

	afterEach(() => {
		rollout?.dispose();
		for (const session of sessions.splice(0)) {
			session.dispose();
		}
		registry.dispose();
	});

	/** Joins worker `id` on `build`, offering `update` unless `offers` is false. */
	async function join(
		id: string,
		build: string,
		{
			kind = "registered",
			offers = true,
		}: { kind?: WorkerKind; offers?: boolean } = {},
	): Promise<void> {
		const pair = new WorkerSocketPair();
		const session = new WorkerSession("worker", {
			capabilities: offers ? [UPDATE] : [],
			timer,
			clock,
		});
		sessions.push(session);
		session.events.on("update", ({ build }) =>
			told.set(id, [...(told.get(id) ?? []), build]),
		);
		const connecting = session.connect(pair.worker, {
			id,
			info: { build },
		});
		await registry.accept(pair.coordinator, kind);
		await connecting;
		await Bun.sleep(0);
	}

	/** Which workers drain to be updated now. */
	const updating = () =>
		records.all.filter((each) => each.updating).map((each) => each.id);

	it("drains one worker at a time, the one with fewest agents first and this machine's last", async () => {
		await join("local", "1.0.0", { kind: "local" });
		await join("busy", "1.0.0");
		await join("few", "1.0.0");
		await join("new", "2.0.0");
		used.set("busy", ["b", "c"]);
		used.set("few", ["a"]);

		const rollout = start();
		await rollout.look();

		expect(updating()).toEqual(["few"]);
		expect(records.of("few")?.draining).toBe(true);
		expect(rollout.standing()).toEqual({
			updating: { id: "few", stage: "moving", agents: 1 },
			next: ["busy", "local"],
			byHand: [],
		});
	});

	it("asks an empty worker to restart on the build once, and lets it take agents again once it is back on it", async () => {
		await join("box", "1.0.0");
		const rollout = start();
		await rollout.look();
		await rollout.look();
		await Bun.sleep(0);

		expect(told.get("box")).toEqual(["2.0.0"]);
		expect(rollout.standing().updating).toEqual({
			id: "box",
			stage: "replacing",
			agents: 0,
		});

		await join("box", "2.0.0");
		await rollout.look();

		expect(records.of("box")).toMatchObject({
			updating: false,
			draining: false,
		});
		expect(rollout.standing()).toEqual({
			updating: null,
			next: [],
			byHand: [],
		});
	});

	it("leaves a worker that cannot be asked to the person, taking agents still", async () => {
		await join("old", "1.0.0", { offers: false });

		const rollout = start();
		await rollout.look();

		expect(updating()).toEqual([]);
		expect(records.of("old")?.draining ?? false).toBe(false);
		expect(rollout.standing().byHand).toEqual(["old"]);
	});

	it("passes over a worker whose drain the person takes back, for this run", async () => {
		await join("box", "1.0.0");
		await join("pc", "1.0.0");
		used.set("box", ["a"]);
		used.set("pc", ["b", "c"]);
		const rollout = start();
		await rollout.look();
		expect(updating()).toEqual(["box"]);

		await records.set("box", { draining: false });
		await rollout.look();

		expect(updating()).toEqual(["pc"]);
		expect(rollout.standing().next).toEqual([]);
	});

	it("passes over a worker that comes back on its old build, rather than restart it again", async () => {
		await join("box", "1.0.0");
		const rollout = start();
		await rollout.look();
		await rollout.look();

		await join("box", "1.0.0");
		await rollout.look();

		expect(told.get("box")).toEqual(["2.0.0"]);
		expect(records.of("box")).toMatchObject({
			updating: false,
			draining: false,
		});
		expect(
			log.entries.map((entry) => String(entry.message)).join("\n"),
		).toContain("worker box restarted on 1.0.0, not 2.0.0: update it by hand");
	});
});
