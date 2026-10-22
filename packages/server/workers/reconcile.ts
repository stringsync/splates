import type { Logger } from "webappwiz/log";
import { Duration, type WallClock } from "webappwiz/time";
import type { WorkerAccess } from "./access";
import type { WorkerBudget } from "./budget";
import type { WorkerProvider } from "./provider";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RunnerLedger } from "./runner-ledger";

/** How often the provider is squared with the records, for machines lost or left behind. */
export const SWEEP_EVERY = Duration.mins(5);

/**
 * How long a machine no record knows is seen before it is destroyed, as one
 * a failed or interrupted provision left; a second look keeps a slow
 * listing from costing a worker.
 */
export const ORPHAN_AFTER = Duration.mins(10);

/** What `ProviderReconciler` squares and with what. */
export interface ProviderReconcilerOptions {
	provider: WorkerProvider;
	records: WorkerRecords;
	registry: WorkerRegistry;
	budget: WorkerBudget;
	ledger?: RunnerLedger;
	access?: WorkerAccess | null;
	log: Logger;
	wall: WallClock;
}

/** Squares the records of made workers with the machines the provider says exist. */
export class ProviderReconciler {
	/** The workers whose machine is being asked for now, which the provider may not list yet. */
	private readonly asked = new Set<string>();
	/** When each machine no record knows was first seen, by id. */
	private readonly unknownSince = new Map<string, number>();

	constructor(private readonly opts: ProviderReconcilerOptions) {}

	/** Runs `create`, asking the provider for worker `id`'s machine, which a reconcile meanwhile keeps. */
	async creating<T>(id: string, create: () => Promise<T>): Promise<T> {
		this.asked.add(id);
		try {
			return await create();
		} finally {
			this.asked.delete(id);
		}
	}

	/**
	 * Squares the records with what the provider says exists: a made worker
	 * whose machine is gone is forgotten, and a machine no record knows,
	 * seen so for `ORPHAN_AFTER`, is destroyed, as one a failed or
	 * interrupted provision left; then the provider sweeps what it leaves
	 * outside its machines. Answers the workers forgotten.
	 */
	async reconcile(): Promise<string[]> {
		const { provider, log } = this.opts;
		const machines = await provider.list();
		const gone = await this.forgetGone(
			new Set(machines.map((machine) => machine.id)),
		);
		await this.destroyOrphans(machines.map((machine) => machine.id));
		for (const swept of (await provider.sweep?.()) ?? []) {
			log.info(`the worker provider deleted ${swept}, left behind`);
		}
		return gone;
	}

	/** Forgets each made worker whose machine is not among `exists`, answering them. */
	private async forgetGone(exists: Set<string>): Promise<string[]> {
		const { records, registry, budget, ledger, access, log, wall } = this.opts;
		const gone: string[] = [];
		for (const record of records.all) {
			if (
				record.provisioned !== null &&
				!exists.has(record.id) &&
				!this.asked.has(record.id)
			) {
				await records.remove(record.id);
				await budget.ended(record.id);
				await ledger?.note({
					row: "runner-ended",
					id: record.id,
					at: new Date(wall.now()).toISOString(),
				});
				if (record.access !== null) {
					await access?.revoke(record.access).catch((error: unknown) => {
						log.error(
							`could not revoke ${record.id}'s service token ${record.access}: ${String(error)}`,
						);
					});
				}
				registry.forget(record.id);
				gone.push(record.id);
			}
		}
		return gone;
	}

	/** Destroys each of `machines` no record has known for `ORPHAN_AFTER`. */
	private async destroyOrphans(machines: string[]): Promise<void> {
		const { provider, records, log, wall } = this.opts;
		const now = wall.now();
		const unknown = new Set<string>();
		for (const id of machines) {
			if (records.of(id) !== undefined) {
				continue;
			}
			unknown.add(id);
			const since = this.unknownSince.get(id);
			if (since === undefined) {
				this.unknownSince.set(id, now);
				log.info(
					`the worker provider has a machine ${id} that splates has no record of: destroying it if it is still so in ${ORPHAN_AFTER.mins} minutes`,
				);
			} else if (now - since >= ORPHAN_AFTER.ms) {
				await provider.destroy(id);
				log.info(`destroyed ${id}, a machine left without a record`);
			}
		}
		for (const id of this.unknownSince.keys()) {
			if (!unknown.has(id)) {
				this.unknownSince.delete(id);
			}
		}
	}
}
