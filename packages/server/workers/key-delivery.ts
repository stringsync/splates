import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, type Timer, timeouts } from "webappwiz/time";
import type { Launch } from "../agents";
import { type KeyedWorker, keyProvider, type WorkerKeys } from "./keys";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";

/** How long a worker being removed is given to drop its keys before it is hung up on. */
const DROP_WAIT = Duration.secs(5);

/**
 * Sends each worker of its own machine the API keys the roster says it
 * holds, which it keeps in memory alone and proxies, so an agent there is
 * launched naming its key and never holding it. This machine's own worker
 * gets none: its agents run signed in as the person.
 */
export class KeyDelivery {
	private readonly keys: WorkerKeys | null;
	private readonly registry: WorkerRegistry;
	private readonly records: WorkerRecords;
	private readonly log: Logger;
	private readonly timer: Timer;

	constructor(opts: KeyDeliveryOptions) {
		this.keys = opts.keys;
		this.registry = opts.registry;
		this.records = opts.records;
		this.log = opts.log;
		this.timer = opts.timer ?? new SystemTimer();
	}

	/**
	 * How `agent` starts on `worker`: once the worker holds its keys, on a
	 * proxy for the one the agent runs on; as `worker.launch` on one that
	 * keeps none.
	 */
	async launch(worker: RemoteWorker, agent: string): Promise<Launch> {
		const keys = this.keys;
		if (keys === null || !this.keeps(worker)) {
			return worker.launch;
		}
		const keyed = this.keyed(worker);
		await worker.sendKeys(await keys.sent(keyed));
		const named = keys.taskKeys(keyed, agent);
		return (argv, cwd, env) => worker.start(argv, cwd, env, named);
	}

	/**
	 * Sends every connected worker the set it holds now, after a key was
	 * added or taken away, so a key taken away leaves at once and a
	 * replaced one reaches the proxies of agents already running.
	 */
	async resend(): Promise<void> {
		const keys = this.keys;
		if (keys === null) {
			return;
		}
		await Promise.all(
			this.registry.workers
				.filter((worker) => worker.connected && this.keeps(worker))
				.map(async (worker) => {
					try {
						await worker.sendKeys(await keys.sent(this.keyed(worker)));
					} catch (error) {
						this.log.error(
							`worker ${worker.id}'s keys were not sent: ${String(error)}`,
						);
					}
				}),
		);
	}

	/**
	 * Has worker `id`, as it is removed, drop every key it holds, waiting a
	 * few seconds at most, then deletes its own from the roster, saying
	 * where to revoke each.
	 */
	async forget(id: string): Promise<void> {
		if (this.keys === null) {
			return;
		}
		const worker = this.registry.worker(id);
		if (worker?.connected && this.keeps(worker)) {
			await timeouts.race(
				this.timer,
				worker.sendKeys([]).catch(() => {}),
				DROP_WAIT,
			);
		}
		for (const key of await this.keys.forget(id)) {
			const provider = keyProvider(key.provider);
			this.log.info(
				`worker ${id}'s ${provider?.name ?? key.provider} key is forgotten: revoke it at ${provider?.keys ?? "its console"}`,
			);
		}
	}

	private keeps(worker: RemoteWorker): boolean {
		return worker.kind !== "local" && worker.keeps;
	}

	private keyed(worker: RemoteWorker): KeyedWorker {
		return {
			id: worker.id,
			type: this.records.of(worker.id)?.provisioned?.type ?? null,
		};
	}
}

/** What a {@link KeyDelivery} sends from and to. */
export interface KeyDeliveryOptions {
	/** The roster, and the store its values are in; null for a coordinator that keeps none, which sends none. */
	keys: WorkerKeys | null;
	registry: WorkerRegistry;
	/** What each worker was made as, whose type's keys it holds. */
	records: WorkerRecords;
	log: Logger;
	/** Bounds the wait on a worker being removed; the system's by default. */
	timer?: Timer;
}
