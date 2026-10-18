import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { WakeTarget } from "./magic-packet";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import type { Pool } from "./scheduler";
import { WorkerWaking } from "./waking";

/**
 * Wakes workers asleep at home: keeps what waking each takes from its
 * hello, and has a worker awake on its network send the packet, for
 * `waking` to wake them when agents queue.
 */
export class WakeRelay implements Resource {
	/** What wakes sleeping workers for the queue, through this relay. */
	readonly waking: WorkerWaking;
	private readonly unlisten: () => void;

	constructor(
		private readonly registry: WorkerRegistry,
		private readonly records: WorkerRecords,
		opts: WakeRelayOptions,
	) {
		this.waking = new WorkerWaking({
			pool: opts.pool,
			send: (id) => this.send(id),
			log: opts.log,
		});
		this.unlisten = registry.events.on("joined", (worker) => {
			if (this.waking.joined(worker.id)) {
				void records.set(worker.id, { wokenAt: Date.now() });
			}
			void this.keep(worker);
		});
	}

	/**
	 * Keeps what waking `worker` takes, as its hello said, for one that
	 * joined by hand and may sleep, so it can be woken while it sleeps
	 * through a restart; forgets it for one that says it no longer sleeps.
	 */
	async keep(worker: RemoteWorker): Promise<void> {
		const record = this.records.of(worker.id);
		if (worker.kind !== "registered" || record === undefined) {
			return;
		}
		const { info } = worker;
		const target = WakeTarget.safeParse(info.wake);
		const wake = target.success
			? {
					...target.data,
					platform: typeof info.platform === "string" ? info.platform : null,
					slots: typeof info.slots === "number" ? info.slots : null,
				}
			: null;
		if (JSON.stringify(wake) !== JSON.stringify(record.wake)) {
			await this.records.set(worker.id, { wake });
		}
	}

	/**
	 * Has an awake worker on worker `id`'s network send the packet that
	 * wakes it, this machine's own first, since a sleeping machine has no
	 * address of its own to reach; throws when none is awake there.
	 */
	async send(id: string): Promise<void> {
		const wake = this.records.of(id)?.wake;
		if (wake == null) {
			throw new Error(`worker ${id} has not said how to wake it`);
		}
		const senders = this.registry.workers
			.filter(
				(worker) =>
					worker.id !== id &&
					worker.connected &&
					worker.wakes &&
					Array.isArray(worker.info.broadcasts) &&
					worker.info.broadcasts.includes(wake.broadcast),
			)
			.sort(
				(one, other) =>
					Number(other.kind === "local") - Number(one.kind === "local"),
			);
		const failures: string[] = [];
		for (const sender of senders) {
			try {
				await sender.wake({ mac: wake.mac, broadcast: wake.broadcast });
				return;
			} catch (error) {
				failures.push(error instanceof Error ? error.message : String(error));
			}
		}
		throw new Error(
			failures.length > 0
				? `no worker could send the packet: ${failures.join("; ")}`
				: `no worker is awake on ${id}'s network (${wake.broadcast}) to send the packet`,
		);
	}

	dispose(): void {
		this.unlisten();
		this.waking.dispose();
	}
}

/** What a `WakeRelay` wakes workers among. */
export interface WakeRelayOptions {
	/** The workers placement sees, asleep ones among them. */
	pool: Pool;
	log: Logger;
}
