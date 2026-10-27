import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { handoffWorker, isHandoffWorker, LOCAL_WORKER } from "./local-id";
import { UPDATE } from "./protocol";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { ConnectedWorker } from "./worker";

/** What a `LocalWorkerUpdate` updates workers over. */
export interface LocalWorkerUpdateOptions {
	registry: WorkerRegistry;
	records: WorkerRecords;
	/** The build the server runs, which every worker is brought to. */
	build: string;
	/** What agents each worker holds, by its id. */
	used: () => Map<string, string[]>;
	/** Whether worker `id` takes agents at all: not this machine's own once it is removed. */
	pooled: (id: string) => boolean;
	/** Tells the scheduler a worker started or stopped draining. */
	poke: () => void;
	/**
	 * Starts a worker known by `id` on the server's build beside this
	 * machine's own, answering whether it could; with none, new agents wait
	 * while this machine's own updates.
	 */
	start?: (id: string) => boolean;
	/** Hangs up on a handoff worker that has stopped and forgets it. */
	forget?: (id: string) => Promise<void>;
	log: Logger;
}

/**
 * Drains and restarts the local worker on the server's build, preserving
 * its agents until they finish. A handoff worker started on the build
 * beside it takes new agents meanwhile, and once this machine's own is back
 * on the build, takes none, stopping once its last agent ends.
 */
export class LocalWorkerUpdate implements Resource {
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

	constructor(private readonly opts: LocalWorkerUpdateOptions) {
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
	 * Carries the local update on: finishes the worker under way once it is back
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
				this.opts.log.error(
					`the worker local update stopped: ${String(error)}`,
				);
			} finally {
				this.looking = null;
			}
		})();
		return this.looking;
	}

	dispose(): void {
		this.unlisten();
	}

	private async step(): Promise<void> {
		await this.handOver();
		const { records, build, used, poke, log } = this.opts;
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
			if (!this.asked.has(under.id) && under.session.update(build)) {
				this.asked.add(under.id);
				log.info(`worker ${under.id} is empty: restarting it on ${build}`);
			}
			return;
		}
		const [next] = this.behind().filter(
			(worker) =>
				worker.connected &&
				this.updatable(worker) &&
				records.of(worker.id)?.updating !== true,
		);
		if (next === undefined) {
			return;
		}
		log.info(
			`worker ${next.id} runs ${String(next.info.build)}: draining it to update to ${build}`,
		);
		await this.startHandoff();
		await records.set(next.id, { updating: true, draining: true });
		poke();
	}

	/**
	 * Starts a worker on the build to take new agents while this machine's
	 * own drains, unless one is already kept for it.
	 */
	private async startHandoff(): Promise<void> {
		const { records, build, start, log } = this.opts;
		const id = handoffWorker(build);
		if (start === undefined || records.of(id) !== undefined) {
			return;
		}
		// Kept first, so it is taken into the pool as it joins.
		await records.set(id, { draining: false });
		if (start(id)) {
			log.info(`started worker ${id} to take new agents meanwhile`);
			return;
		}
		log.error(
			`worker ${id} could not start: new agents wait for ${LOCAL_WORKER}`,
		);
		await records.drop(id);
	}

	/**
	 * Drains each handoff worker once this machine's own is back on the
	 * build, or once it is on another build itself, and stops and forgets
	 * each drained one once empty. One no record keeps, as one left
	 * running by an earlier server, is stopped at once.
	 */
	private async handOver(): Promise<void> {
		const { registry, records, build, used, poke, log } = this.opts;
		const own = registry.worker(LOCAL_WORKER);
		const settled =
			own?.connected === true &&
			own.info.build === build &&
			records.of(LOCAL_WORKER)?.updating !== true;
		for (const worker of registry.workers) {
			if (!isHandoffWorker(worker.id)) {
				continue;
			}
			const record = records.of(worker.id);
			const outdated =
				typeof worker.info.build === "string" && worker.info.build !== build;
			if (record !== undefined && !record.draining && (settled || outdated)) {
				log.info(
					`worker ${LOCAL_WORKER} is on ${build}: ${worker.id} takes no new agents, stopping once its own end`,
				);
				await records.set(worker.id, { draining: true });
				poke();
				continue;
			}
			const empty = (used().get(worker.id) ?? []).length === 0;
			if (record === undefined || (record.draining && empty)) {
				// Its daemon ends on an update, never started again.
				worker.session.update(build);
				await this.opts.forget?.(worker.id);
				log.info(`worker ${worker.id} stopped`);
			}
		}
	}

	/**
	 * The worker a local update is updating, if any: one asked to restart that
	 * has yet to come back holds up none, so one that never does leaves the
	 * rest to carry on, drained meanwhile.
	 */
	private underWay(): ConnectedWorker | undefined {
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
	private behind(): ConnectedWorker[] {
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

	private pool(): ConnectedWorker[] {
		return this.opts.registry.workers.filter(
			(worker) => worker.id === LOCAL_WORKER && this.opts.pooled(worker.id),
		);
	}

	/** Whether `worker` can be brought to the build from here: asked to restart. */
	private updatable(worker: ConnectedWorker): boolean {
		const negotiated = worker.session.negotiated;
		return negotiated?.ok === true && negotiated.capabilities.includes(UPDATE);
	}
}
