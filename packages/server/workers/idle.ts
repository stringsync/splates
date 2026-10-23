import { Duration, type WallClock } from "webappwiz/time";
import type { WorkerRecords } from "./records";
import type { Scheduler } from "./scheduler";

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

	constructor(
		private readonly records: WorkerRecords,
		private readonly wall: WallClock,
	) {}

	/** Stops tracking worker `id`, as when it is destroyed. */
	forget(id: string): void {
		this.since.delete(id);
	}

	/**
	 * Notes which made workers are idle now, as it changes: none holds an
	 * agent and none is in `busy`, workers kept busy for another reason such
	 * as a job running on them; a worker still booting included.
	 */
	track(scheduler: Scheduler, busy: Iterable<string> = []): void {
		const now = this.wall.now();
		const held = new Set([
			...scheduler.held().map((each) => each.worker),
			...busy,
		]);
		const live = new Set<string>();
		for (const record of this.records.all) {
			if (record.provisioned === null || record.removing) {
				continue;
			}
			live.add(record.id);
			if (held.has(record.id)) {
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
