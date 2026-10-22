import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, SystemWallClock, sleep } from "webappwiz/time";
import { openReplica, Replicator } from "../replica";
import type { Project } from "./project";

/** How long a stopping server waits for a project's last batch to reach its replica. */
const LAST_FLUSH = Duration.secs(10);

/**
 * The replicators of this server's projects, one per root: a project
 * replicates from the server's start whether or not a page ever opens it,
 * and opening it later finds the one already running, since two writing
 * one replica would refuse each other.
 */
export class Replicas {
	private readonly running = new Map<string, Replicator | null>();

	constructor(private readonly log: Logger) {}

	/**
	 * Starts copying the project's records into the replica its config names,
	 * unless that is under way, and returns it, or null when it names none. A
	 * replica it cannot reach yet is tried again on its own, so nothing waits
	 * on it.
	 */
	of(project: Project): Replicator | null {
		const root = project.service.git.root;
		const had = this.running.get(root);
		if (had !== undefined) {
			return had;
		}
		const { service, storage, fs, log, ps, creds } = project;
		const place = service.config.replica;
		let replicator: Replicator | null = null;
		if (place !== null) {
			replicator = new Replicator({
				storage,
				replica: openReplica(place, { root, fs, creds }),
				timer: new SystemTimer(),
				clock: new SystemWallClock(),
				log,
				host: ps.hostname,
			});
			replicator.start().catch((error) => this.log.error(`replica: ${error}`));
		}
		this.running.set(root, replicator);
		return replicator;
	}

	/** What changed in the last seconds goes before the server does, unless a store is slow. */
	async disposeAsync(): Promise<void> {
		await Promise.all(
			[...this.running.values()].map(async (replicator) => {
				if (replicator !== null) {
					await Promise.race([replicator.flush(), sleep(LAST_FLUSH)]);
					replicator.dispose();
				}
			}),
		);
		this.running.clear();
	}
}
