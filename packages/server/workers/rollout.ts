import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { UPDATE } from "./protocol";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker, WorkerKind } from "./remote";

/** Where a rollout stands, as `GET /api/workers` answers it. */
export interface RolloutStanding {
	/** The worker being updated now; null when none is. */
	updating: {
		id: string;
		/** `moving` while agents are still on it, `replacing` once it is empty and being made again or restarted. */
		stage: "moving" | "replacing";
		/** The agents still on it. */
		agents: number;
	} | null;
	/** Those on another build waiting their turn, the next first. */
	next: string[];
	/** Those on another build that cannot update from here, for the person to update by hand. */
	byHand: string[];
}

/** What a `WorkerRollout` updates workers over. */
export interface WorkerRolloutOptions {
	registry: WorkerRegistry;
	records: WorkerRecords;
	/** The build the server runs, which every worker is brought to. */
	build: string;
	/** What holds each worker's slots, by its id. */
	used: () => Map<string, string[]>;
	/** Whether worker `id` takes agents at all: not this machine's own once it is removed. */
	pooled: (id: string) => boolean;
	/** Whether a provider made worker `id`, so it is replaced rather than restarted. */
	made: (id: string) => boolean;
	/** Destroys made worker `id`, now empty: the queue makes another from the new snapshot. */
	replace: (id: string) => Promise<void>;
	/** Tells the scheduler a worker started or stopped draining. */
	poke: () => void;
	log: Logger;
}

/** Which kind of worker a rollout takes first: those it can make again, then the rest, this machine's last for its page's shells. */
const ORDER: Record<WorkerKind, number> = {
	provisioned: 0,
	registered: 1,
	local: 2,
};

/**
 * Brings every worker to the server's build, one at a time, so the
 * pool keeps the rest of its slots meanwhile: the worker drains, marked
 * `updating` in its record so a restart carries on; its agents move off at
 * their next pause from their saved task (`Grant.replaces`); and once it is
 * empty it is destroyed, for one a provider made, which the queue makes
 * again from the new snapshot, or asked to restart on the build, which it
 * does once it offers `update`. One that cannot be asked is left to the
 * person, and placed on last meanwhile.
 */
export class WorkerRollout implements Resource {
	/**
	 * Those whose update the person took back, by `splates worker drain
	 * --undo`, or that came back on the old build; tried again next run.
	 */
	private readonly passed = new Set<string>();
	/** Those asked to restart on the build, until they join again. */
	private readonly asked = new Set<string>();
	private looking: Promise<void> | null = null;
	private again = false;
	private readonly unlisten: () => void;

	constructor(private readonly opts: WorkerRolloutOptions) {
		this.unlisten = opts.registry.events.on("joined", (worker) => {
			// Back on the old build: restarting it again would only loop.
			if (this.asked.delete(worker.id) && worker.info.build !== opts.build) {
				opts.log.error(
					`worker ${worker.id} restarted on ${String(worker.info.build)}, not ${opts.build}: update it by hand`,
				);
				this.passed.add(worker.id);
			}
			void this.look();
		});
	}

	/**
	 * Carries the rollout on: finishes the worker under way once it is back
	 * on the build, replaces it once it is empty, and starts on the next once
	 * none is under way. Looks once at a time, and once more after for what
	 * changed meanwhile.
	 */
	look(): Promise<void> {
		if (this.looking !== null) {
			this.again = true;
			return this.looking;
		}
		this.looking = (async () => {
			try {
				do {
					this.again = false;
					await this.step();
				} while (this.again);
			} catch (error) {
				this.opts.log.error(`the worker rollout stopped: ${String(error)}`);
			} finally {
				this.looking = null;
			}
		})();
		return this.looking;
	}

	dispose(): void {
		this.unlisten();
	}

	/** Where the rollout stands now. */
	standing(): RolloutStanding {
		const used = this.opts.used();
		const under = this.underWay();
		const behind = this.behind().filter(
			(worker) => this.opts.records.of(worker.id)?.updating !== true,
		);
		return {
			updating:
				under === undefined
					? null
					: {
							id: under.id,
							stage:
								(used.get(under.id) ?? []).length > 0 ? "moving" : "replacing",
							agents: (used.get(under.id) ?? []).length,
						},
			next: behind
				.filter((worker) => this.updatable(worker))
				.sort(this.order(used))
				.map((worker) => worker.id),
			byHand: behind
				.filter((worker) => !this.updatable(worker))
				.map((worker) => worker.id),
		};
	}

	private async step(): Promise<void> {
		const { records, build, used, made, replace, poke, log } = this.opts;
		for (const worker of this.pool()) {
			const record = records.of(worker.id);
			if (record?.updating !== true) {
				continue;
			}
			if (worker.info.build === build || this.passed.has(worker.id)) {
				await records.set(worker.id, { updating: false, draining: false });
				if (worker.info.build === build) {
					log.info(`worker ${worker.id} is on ${build}`);
				}
				poke();
			} else if (!record.draining) {
				// The person took its drain back: it stays as it is this run.
				await records.set(worker.id, { updating: false });
				this.passed.add(worker.id);
				poke();
			}
		}
		const under = this.underWay();
		if (under !== undefined) {
			if ((used().get(under.id) ?? []).length > 0) {
				return;
			}
			if (!made(under.id)) {
				if (!this.asked.has(under.id) && under.session.update(build)) {
					this.asked.add(under.id);
					log.info(`worker ${under.id} is empty: restarting it on ${build}`);
				}
				return;
			}
			log.info(`worker ${under.id} is empty: replacing it on ${build}`);
			await replace(under.id);
		}
		const [next] = this.behind()
			.filter(
				(worker) =>
					worker.connected &&
					this.updatable(worker) &&
					records.of(worker.id)?.updating !== true,
			)
			.sort(this.order(used()));
		if (next === undefined) {
			return;
		}
		log.info(
			`worker ${next.id} runs ${String(next.info.build)}: draining it to update to ${build}`,
		);
		await records.set(next.id, { updating: true, draining: true });
		poke();
	}

	/**
	 * The worker a rollout is updating, if any: one asked to restart that
	 * has yet to come back holds up none, so one that never does leaves the
	 * rest to carry on, drained meanwhile.
	 */
	private underWay(): RemoteWorker | undefined {
		return this.pool().find(
			(worker) =>
				this.opts.records.of(worker.id)?.updating === true &&
				!(this.asked.has(worker.id) && !worker.connected),
		);
	}

	/**
	 * Those in the pool on another build, but for any the person drains or
	 * removes, or took back from this run.
	 */
	private behind(): RemoteWorker[] {
		const { records, build } = this.opts;
		return this.pool().filter((worker) => {
			const record = records.of(worker.id);
			return (
				typeof worker.info.build === "string" &&
				worker.info.build !== build &&
				record?.removing !== true &&
				(record?.updating === true || record?.draining !== true) &&
				!this.passed.has(worker.id)
			);
		});
	}

	private pool(): RemoteWorker[] {
		return this.opts.registry.workers.filter((worker) =>
			this.opts.pooled(worker.id),
		);
	}

	/** Whether `worker` can be brought to the build from here: made again, or asked to restart. */
	private updatable(worker: RemoteWorker): boolean {
		if (this.opts.made(worker.id)) {
			return true;
		}
		const negotiated = worker.session.negotiated;
		return negotiated?.ok === true && negotiated.capabilities.includes(UPDATE);
	}

	/** Kind by kind, as `ORDER` says, and the one with fewest agents first within each. */
	private order(
		used: Map<string, string[]>,
	): (one: RemoteWorker, other: RemoteWorker) => number {
		const kind = (worker: RemoteWorker) =>
			this.opts.made(worker.id) ? ORDER.provisioned : ORDER[worker.kind];
		const agents = (worker: RemoteWorker) => (used.get(worker.id) ?? []).length;
		return (one, other) =>
			kind(one) - kind(other) || agents(one) - agents(other);
	}
}
