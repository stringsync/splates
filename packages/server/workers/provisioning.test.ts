import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { joinAccess } from "./access";
import { WorkerBudget } from "./budget";
import { ORPHAN_AFTER, WorkerProvisioning } from "./provisioning";
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
		const boot = provider.specs[0]?.boot ?? [];
		expect(boot).toContain("https://splates.example.com");
		expect(boot).toContain("--ephemeral");
		const token = boot[boot.indexOf("--join") + 1] ?? "";
		expect(joinAccess(token)).toEqual({
			clientId: "client-1.access",
			clientSecret: "secret-1",
		});
		expect(await records.join(token, worker.id)).not.toBeNull();
		expect(records.of(worker.id)?.access).toBe("st-1");
	});

	it("counts a made worker's spend from when it is made until it is destroyed", async () => {
		const { made, budget } = await provisioning();

		const worker = await made.provision();
		expect(budget.rate()).toBe(0.05);
		await made.destroy(worker.id);

		expect(budget.rate()).toBe(0);
	});

	it("keeps who holds slots on made workers, for the budget's split", async () => {
		const wall = new FakeWallClock();
		const { made, budget } = await provisioning(
			undefined,
			undefined,
			WorkerBudget.memory(wall),
		);
		const worker = await made.provision();
		const scheduler = new Scheduler(
			{
				workers: () => [
					{
						id: worker.id,
						kind: "provisioned",
						slots: 4,
						platform: "linux",
						awake: true,
						checkouts: true,
						runs: () => true,
					},
				],
			},
			{ now: () => Date.now() },
		);
		made.watch(scheduler);

		await scheduler.take({
			id: "c",
			project: "/p",
			task: "fix-it",
			platform: null,
			agent: "claude",
		});
		await Bun.sleep(0);
		wall.advance(Duration.mins(10));
		made.dispose();

		expect(budget.split("day").map((share) => share.task)).toEqual(["fix-it"]);
	});

	it("counts nothing for a worker its provider failed to make", async () => {
		const provider = new FakeWorkerProvider([...TYPES]);
		provider.create = async () => {
			throw new Error("quota");
		};
		const { made, budget } = await provisioning(provider);

		await expect(made.provision()).rejects.toThrow("quota");
		expect(budget.rate()).toBe(0);
	});

	it("makes the type asked for", async () => {
		const { made } = await provisioning();

		expect((await made.provision({ type: "big" })).type).toBe("big");
	});

	it("makes none without a URL to dial", async () => {
		const { provider, made } = await provisioning(undefined, null);

		await expect(made.provision()).rejects.toThrow("tunnel");
		expect(provider.getCalls()).toEqual([]);
	});

	it("forgets a worker its provider failed to make", async () => {
		const provider = new FakeWorkerProvider([...TYPES]);
		provider.create = async () => {
			throw new Error("quota");
		};
		const { records, registry, made } = await provisioning(provider);

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

	it("never forgets a worker whose machine is still being asked for", async () => {
		const provider = new FakeWorkerProvider([...TYPES]);
		const { records, made } = await provisioning(provider);
		const create = provider.create.bind(provider);
		const forgotten: string[][] = [];
		provider.create = async (spec) => {
			forgotten.push(await made.reconcile());
			return create(spec);
		};

		const worker = await made.provision();

		expect(forgotten).toEqual([[]]);
		expect(records.of(worker.id)).toBeDefined();
	});

	it("has the provider sweep what it left behind", async () => {
		const provider = new FakeWorkerProvider([...TYPES]);
		provider.leftovers.push("a builder");
		const { made, log } = await provisioning(provider);

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
});

/** The join token worker `id` was booted with. */
function joinTokenOf(provider: FakeWorkerProvider, id: string): string {
	const boot = provider.specs.find((each) => each.id === id)?.boot ?? [];
	return boot[boot.indexOf("--join") + 1] ?? "";
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
	provider = new FakeWorkerProvider([...TYPES]),
	coordinator: string | null = "https://splates.example.com",
	budget = WorkerBudget.memory(),
) {
	const wall = new FakeWallClock();
	const records = WorkerRecords.memory();
	const log = new MemoryLogger();
	const registry = new WorkerRegistry(new MemoryLogger());
	const access = new FakeWorkerAccess();
	const made = new WorkerProvisioning({
		provider,
		snapshots: await Snapshots.open(provider, { version: "1.0.0", path: null }),
		records,
		registry,
		access,
		coordinator: () => coordinator,
		budget,
		log,
		wall,
	});
	return { provider, records, registry, access, made, budget, log, wall };
}
