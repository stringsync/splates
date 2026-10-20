import { Duration, type WallClock } from "webappwiz/time";
import type { WorkerType } from "./provider";
import type { WorkerRecords } from "./records";
import type { Platform, Scheduler } from "./scheduler";

/** How long a made worker may be idle before it is destroyed, unless its provider says otherwise. */
export const DEFAULT_IDLE_AFTER = Duration.mins(15);

/**
 * How much of a paid hour is left when an idle worker billed by the hour is
 * destroyed: enough for the destroy to finish before the next hour starts,
 * so it is never billed for one more.
 */
export const HOUR_END_MARGIN = Duration.mins(5);

const HOUR = Duration.hrs(1);

/** When each made worker went idle, and which are due to be destroyed for it. */
export class IdleWorkers {
	/** When each made worker was first seen idle, by id; absent while it is busy. */
	private readonly since = new Map<string, number>();
	/** The platform of each type the provider has made, for what a queued agent could take. */
	private readonly platforms = new Map<string, Platform>();

	constructor(
		private readonly records: WorkerRecords,
		private readonly wall: WallClock,
	) {}

	/** Notes the platform of each of `types`, for which queued agents a worker could take. */
	learn(types: WorkerType[]): void {
		for (const type of types) {
			this.platforms.set(type.name, type.platform);
		}
	}

	/** Stops tracking worker `id`, as when it is destroyed. */
	forget(id: string): void {
		this.since.delete(id);
	}

	/**
	 * Notes which made workers are idle now, as it changes: none holds an
	 * agent and none queued could take it, a worker still booting included.
	 */
	track(scheduler: Scheduler): void {
		const now = this.wall.now();
		const held = new Set(scheduler.held().map((each) => each.worker));
		const queued = scheduler.queue();
		const live = new Set<string>();
		for (const record of this.records.all) {
			if (record.provisioned === null || record.removing) {
				continue;
			}
			live.add(record.id);
			const platform = this.platforms.get(record.provisioned.type);
			const wanted = queued.some(
				(entry) => platform === undefined || entry.platform === platform,
			);
			if (held.has(record.id) || wanted) {
				this.since.delete(record.id);
			} else if (!this.since.has(record.id)) {
				this.since.set(record.id, now);
			}
		}
		for (const id of this.since.keys()) {
			if (!live.has(id)) {
				this.since.delete(id);
			}
		}
	}

	/**
	 * The made workers idle for `after`: each at once when its type bills by
	 * the second, else only in the last `HOUR_END_MARGIN` of the hour it has
	 * paid for, counted from its creation.
	 */
	due(after: Duration): string[] {
		const now = this.wall.now();
		const due: string[] = [];
		for (const [id, since] of this.since) {
			const made = this.records.of(id)?.provisioned;
			if (made == null || now - since < after.ms) {
				continue;
			}
			if (made.billing === "hour") {
				const sinceCreated = now - (made.createdAt ?? since);
				const left = HOUR.ms - (sinceCreated % HOUR.ms);
				if (left > HOUR_END_MARGIN.ms) {
					continue;
				}
			}
			due.push(id);
		}
		return due;
	}
}
