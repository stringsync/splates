import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
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
	log: Logger;
}

/** Drains and restarts the local worker on the server's build, preserving its agents until they finish. */
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
		await records.set(next.id, { updating: true, draining: true });
		poke();
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
			(worker) => worker.id === "local" && this.opts.pooled(worker.id),
		);
	}

	/** Whether `worker` can be brought to the build from here: asked to restart. */
	private updatable(worker: ConnectedWorker): boolean {
		const negotiated = worker.session.negotiated;
		return negotiated?.ok === true && negotiated.capabilities.includes(UPDATE);
	}
}
