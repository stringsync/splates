import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import type { RunnerRow } from "../spend";
import { joinAccess } from "./access";
import { WorkerBudget } from "./budget";
import { OWN_BUILD_HEADER, OwnBuild } from "./own-build";
import { WorkerProvisioning } from "./provisioning";
import { ORPHAN_AFTER } from "./reconcile";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { Scheduler } from "./scheduler";
import { Snapshots } from "./snapshot";
import { FakeWorkerAccess, FakeWorkerProvider } from "./testing";

describe("WorkerProvisioning", () => {
	it("makes the cheapest type it can boot, joining with a token of its own", async () => {
		const { provider, records, registry, made } = await provisioning();

		const worker = await made.provision();

		expect(worker).toMatchObject({ type: "small", dollarsPerHour: 0.05 });
		expect(records.of(worker.id)?.provisioned).toEqual({
			type: "small",
			dollarsPerHour: 0.05,
			billing: "second",
			createdAt: expect.any(Number),
		});
		expect(registry.worker(worker.id)?.kind).toBe("provisioned");
		const { join = [], joinEnv, boot = [] } = provider.specs[0] ?? {};
		expect(boot).toContain("https://splates.example.com");
		expect(boot).not.toContain("--join");
		// The token is in the join's environment: an argument shows in the process list.
		expect(join).not.toContain("--join");
		const token = joinEnv?.SPLATES_WORKER_JOIN ?? "";
		expect(joinAccess(token)).toEqual({
			clientId: "client-1.access",
			clientSecret: "secret-1",
		});
		expect(await records.join(token, worker.id)).not.toBeNull();
		expect(records.of(worker.id)?.access).toBe("st-1");
	});

	it("has a worker it makes fetch the server's own build, by a token of its own, when the server runs from a checkout", async () => {
		const released = await provisioning();
		await released.made.provision();
		const ownBuild = new OwnBuild({ log: new MemoryLogger() });
		const { provider, made } = await provisioning(
			"https://splates.example.com",
			ownBuild,
		);

		await made.provision();
		await made.provision();

		expect(released.provider.specs[0]?.build).toBeNull();
		const [first, second] = provider.specs.map((spec) => spec.build);
		expect(first?.url).toBe("https://splates.example.com/api/workers/join");
		expect(first?.token).not.toBe(second?.token);
		const fetched = await ownBuild.serve(
			new Request(first?.url ?? "", {
				headers: { [OWN_BUILD_HEADER]: "not-granted" },
			}),
		);
		expect(fetched.status).toBe(401);
	});

	it("counts a made worker's spend from when it is made until it is destroyed", async () => {
		const { made, budget } = await provisioning();

		const worker = await made.provision();
		expect(budget.rate()).toBe(0.05);
		await made.destroy(worker.id);

		expect(budget.rate()).toBe(0);
	});

	it("keeps who holds slots on made workers, for the budget's split", async () => {
		const { made, budget, wall } = await provisioning();
		const scheduler = schedulerOn((await made.provision()).id);
		made.watch(scheduler);

		await scheduler.take({
			id: "c",
			project: "/p",
			task: "fix-it",
			agent: "claude",
		});
		await Bun.sleep(0);
		wall.advance(Duration.mins(10));
		made.dispose();

		expect(budget.split("day").map((share) => share.task)).toEqual(["fix-it"]);
	});

	it("keeps each runner's life in the ledger, at the price it was made at, until destroyed or found gone", async () => {
		const { provider, records, made, ledger, wall } = await provisioning();
		provider.billing = "digitalocean";
		const destroyed = await made.provision();
		wall.advance(Duration.mins(30));
		await made.destroy(destroyed.id);
		await records.remove(destroyed.id);
		const gone = await made.provision();
		await provider.destroy(gone.id);
		await made.reconcile();

		expect(ledger.rows).toEqual([
			{
				row: "runner",
				id: destroyed.id,
				type: "small",
				provider: "digitalocean",
				dollarsPerHour: 0.05,
				at: expect.any(String),
			},
			{ row: "runner-ended", id: destroyed.id, at: expect.any(String) },
			expect.objectContaining({ row: "runner", id: gone.id }),
			{ row: "runner-ended", id: gone.id, at: expect.any(String) },
		]);
		const [made1, ended1] = ledger.rows;
		expect(Date.parse(ended1?.at ?? "") - Date.parse(made1?.at ?? "")).toBe(
			Duration.mins(30).ms,
		);
	});

	it("ends in the ledger a runner its provider failed to make", async () => {
		const { provider, made, ledger } = await provisioning();
		provider.create = async () => {
			throw new Error("quota");
		};

		await expect(made.provision()).rejects.toThrow("quota");
		expect(ledger.rows.map((row) => row.row)).toEqual([
			"runner",
			"runner-ended",
		]);
	});

	it("counts nothing for a worker its provider failed to make", async () => {
		const { provider, made, budget } = await provisioning();
		provider.create = async () => {
			throw new Error("quota");
		};

		await expect(made.provision()).rejects.toThrow("quota");
		expect(budget.rate()).toBe(0);
	});

	it("makes the type asked for", async () => {
		const { made } = await provisioning();

		expect((await made.provision({ type: "big" })).type).toBe("big");
	});

	it("makes none without a URL to dial", async () => {
		const { provider, made } = await provisioning(null);

		await expect(made.provision()).rejects.toThrow("tunnel");
		expect(provider.getCalls()).toEqual([]);
	});

	it("forgets a worker its provider failed to make", async () => {
		const { provider, records, registry, made } = await provisioning();
		provider.create = async () => {
			throw new Error("quota");
		};

		await expect(made.provision()).rejects.toThrow("quota");
		expect(records.all).toEqual([]);
		expect(registry.workers).toEqual([]);
	});

	it("forgets made workers whose machines are gone, and leaves a machine it has no record of at first look", async () => {
		const { provider, records, made } = await provisioning();
		const kept = await made.provision();
		const gone = await made.provision();
		await provider.destroy(gone.id);
		provider.adopt({ id: "stranger", type: "small" });

		expect(await made.reconcile()).toEqual([gone.id]);
		expect(records.of(kept.id)).toBeDefined();
		expect(await provider.list()).toContainEqual({
			id: "stranger",
			type: "small",
		});
	});

	it("destroys a machine it has no record of once seen so for ORPHAN_AFTER", async () => {
		const { provider, made, wall } = await provisioning();
		provider.adopt({ id: "left", type: "small" });

		await made.reconcile();
		wall.advance(Duration.mins(9));
		await made.reconcile();
		expect(await provider.list()).toEqual([{ id: "left", type: "small" }]);

		wall.advance(ORPHAN_AFTER);
		await made.reconcile();
		expect(await provider.list()).toEqual([]);
	});

	it("has the provider sweep what it left behind", async () => {
		const { provider, made, log } = await provisioning();
		provider.leftovers.push("a builder");

		await made.reconcile();

		expect(log.entries.map((entry) => entry.message)).toContainEqual(
			expect.stringContaining("a builder"),
		);
	});

	it("revokes the service token of a made worker whose machine is gone", async () => {
		const { provider, records, access, made } = await provisioning();
		const gone = await made.provision();
		await records.join(joinTokenOf(provider, gone.id), gone.id);
		await provider.destroy(gone.id);

		await made.reconcile();

		expect(access.revoked).toEqual(["st-1"]);
	});

	it("makes no second worker for queued tasks a joined worker has slots free for", async () => {
		const { provider, made } = await provisioning();
		const scheduler = schedulerOn("joined");
		scheduler.want("/p", [
			{ id: "q", project: "/p", task: "t", agent: "claude" },
		]);

		made.watch(scheduler);
		await made.refill();
		made.dispose();

		expect(provider.specs).toEqual([]);
	});
});

/** A scheduler whose one worker is made worker `id`, of four slots. */
function schedulerOn(id: string): Scheduler {
	return new Scheduler(
		{
			workers: () => [
				{
					id,
					slots: 4,
					awake: true,
				},
			],
		},
		{ now: () => Date.now() },
	);
}

/** The join token worker `id` was booted with. */
function joinTokenOf(provider: FakeWorkerProvider, id: string): string {
	return (
		provider.specs.find((each) => each.id === id)?.joinEnv
			.SPLATES_WORKER_JOIN ?? ""
	);
}

/** What the provider makes: a Mac cheapest, which no snapshot boots yet. */
const TYPES = [
	{
		name: "big",
		platform: "linux",
		slots: 16,
		dollarsPerHour: 0.4,
		billing: "second",
	},
	{
		name: "small",
		platform: "linux",
		slots: 4,
		dollarsPerHour: 0.05,
		billing: "second",
	},
	{
		name: "mac",
		platform: "macos",
		slots: 4,
		dollarsPerHour: 0.01,
		billing: "second",
	},
] as const;

/** A `WorkerProvisioning` over `provider`, with what it keeps. */
async function provisioning(
	coordinator: string | null = "https://splates.example.com",
	ownBuild: OwnBuild | null = null,
) {
	const provider = new FakeWorkerProvider([...TYPES]);
	const wall = new FakeWallClock();
	const budget = WorkerBudget.memory(wall);
	const records = WorkerRecords.memory();
	const log = new MemoryLogger();
	const registry = new WorkerRegistry(new MemoryLogger());
	const access = new FakeWorkerAccess();
	const ledger = {
		rows: [] as RunnerRow[],
		async note(...rows: RunnerRow[]) {
			ledger.rows.push(...rows);
		},
	};
	const made = new WorkerProvisioning({
		provider,
		snapshots: await Snapshots.open(provider, {
			version: "1.0.0",
			document: null,
		}),
		records,
		registry,
		access,
		coordinator: () => coordinator,
		ownBuild,
		budget,
		ledger,
		log,
		wall,
	});
	return {
		provider,
		records,
		registry,
		access,
		made,
		budget,
		ledger,
		log,
		wall,
	};
}
