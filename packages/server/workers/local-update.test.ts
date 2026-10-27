import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { LocalWorkerUpdate } from "./local-update";
import { UPDATE } from "./protocol";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { WorkerSession } from "./session";
import { WorkerSocketPair } from "./testing";
import type { WorkerKind } from "./worker";

describe("LocalWorkerUpdate", () => {
	let timer: FakeTimer;
	let clock: FakeClock;
	let log: MemoryLogger;
	let registry: WorkerRegistry;
	let records: WorkerRecords;
	/** The agents on each worker, by its id. */
	let used: Map<string, string[]>;
	/** The builds each worker was asked to restart on, by its id. */
	let told: Map<string, string[]>;
	let rollout: LocalWorkerUpdate | undefined;
	/** The handoff workers started, and those stopped and forgotten. */
	let started: string[];
	let forgot: string[];
	const sessions: WorkerSession[] = [];

	beforeEach(() => {
		timer = new FakeTimer();
		clock = new FakeClock();
		log = new MemoryLogger();
		registry = new WorkerRegistry(log, { timer, clock });
		records = WorkerRecords.memory();
		used = new Map();
		told = new Map();
		started = [];
		forgot = [];
	});

	/**
	 * Starts the rollout over the workers joined so far, as a server does as
	 * it comes up; with `handoff`, starting a worker beside the local one
	 * answers it.
	 */
	function start({ handoff }: { handoff?: boolean } = {}): LocalWorkerUpdate {
		rollout = new LocalWorkerUpdate({
			registry,
			records,
			build: "2.0.0",
			used: () => used,
			pooled: () => true,
			poke: () => {},
			...(handoff === undefined
				? {}
				: {
						start: (id: string) => {
							started.push(id);
							return handoff;
						},
						forget: async (id: string) => {
							forgot.push(id);
							registry.forget(id);
							await records.drop(id);
						},
					}),
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
			kind = "local",
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

	it("waits for the local worker's agents before asking it to restart", async () => {
		await join("local", "1.0.0");
		used.set("local", ["task"]);
		const updater = start();
		await updater.look();
		await updater.look();
		expect(records.of("local")).toMatchObject({
			draining: true,
			updating: true,
		});
		expect(told.get("local")).toBeUndefined();
		used.clear();
		await updater.look();
		await Bun.sleep(0);
		expect(told.get("local")).toEqual(["2.0.0"]);
	});

	it("asks an empty worker to restart on the build once, and lets it take agents again once it is back on it", async () => {
		await join("local", "1.0.0");
		const rollout = start();
		await rollout.look();
		await rollout.look();
		await Bun.sleep(0);

		expect(told.get("local")).toEqual(["2.0.0"]);

		await join("local", "2.0.0");
		await rollout.look();

		expect(records.of("local")).toMatchObject({
			updating: false,
			draining: false,
		});
	});

	it("leaves a worker that cannot be asked to the person, taking agents still", async () => {
		await join("local", "1.0.0", { offers: false });

		const rollout = start();
		await rollout.look();

		expect(updating()).toEqual([]);
		expect(records.of("local")?.draining ?? false).toBe(false);
	});

	it("passes over a worker that comes back on its old build, rather than restart it again", async () => {
		await join("local", "1.0.0");
		const rollout = start();
		await rollout.look();
		await rollout.look();

		await join("local", "1.0.0");
		await rollout.look();

		expect(told.get("local")).toEqual(["2.0.0"]);
		expect(records.of("local")).toMatchObject({
			updating: false,
			draining: false,
		});
		expect(
			log.entries.map((entry) => String(entry.message)).join("\n"),
		).toContain(
			"worker local restarted on 1.0.0, not 2.0.0: update it by hand",
		);
	});

	it("starts a handoff worker on the build as the local worker drains, once", async () => {
		await join("local", "1.0.0");
		used.set("local", ["task"]);
		const rollout = start({ handoff: true });
		await rollout.look();
		await rollout.look();

		expect(started).toEqual(["local-2.0.0"]);
		expect(records.of("local-2.0.0")).toMatchObject({ draining: false });
		expect(records.of("local")).toMatchObject({
			draining: true,
			updating: true,
		});
	});

	it("drains the local worker as today when no handoff worker can start", async () => {
		await join("local", "1.0.0");
		const rollout = start({ handoff: false });
		await rollout.look();

		expect(started).toEqual(["local-2.0.0"]);
		expect(records.of("local-2.0.0")).toBeUndefined();
		expect(records.of("local")).toMatchObject({ draining: true });
	});

	it("has the handoff worker take agents until the local worker is back on the build, then stops once its own end", async () => {
		await join("local", "1.0.0");
		const rollout = start({ handoff: true });
		await rollout.look();
		await join("local-2.0.0", "2.0.0");
		used.set("local-2.0.0", ["task"]);
		await rollout.look();
		expect(records.of("local-2.0.0")).toMatchObject({ draining: false });

		await join("local", "2.0.0");
		await rollout.look();
		expect(records.of("local-2.0.0")).toMatchObject({ draining: true });
		expect(forgot).toEqual([]);

		used.delete("local-2.0.0");
		await rollout.look();
		await Bun.sleep(0);
		expect(forgot).toEqual(["local-2.0.0"]);
		expect(told.get("local-2.0.0")).toEqual(["2.0.0"]);
		expect(records.of("local-2.0.0")).toBeUndefined();
	});

	it("stops a handoff worker no record keeps as it joins", async () => {
		await join("local", "2.0.0");
		const rollout = start({ handoff: true });
		await join("local-1.0.0", "1.0.0");
		await rollout.look();
		await Bun.sleep(0);

		expect(forgot).toEqual(["local-1.0.0"]);
		expect(told.get("local-1.0.0")).toEqual(["2.0.0"]);
	});
});
