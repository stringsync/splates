import type { Resource } from "webappwiz/disposable";
import { type Clock, Duration, type Timer } from "webappwiz/time";

/** How often `OrphanBound` counts, at most. */
const TICK = Duration.secs(10);

/**
 * Counts the time a worker spends without its server while the machine
 * is awake, so a laptop whose lid was shut for an hour does not wake to end
 * every agent it runs before it has even redialed. Time asleep shows as a
 * gap between ticks far longer than one: only a tick of it counts, and the
 * worker is told it woke, to redial at once rather than wait out its backoff.
 */
export class OrphanBound implements Resource {
	private readonly tick: Duration;
	private readonly ticking: Resource;
	private last: number;
	private awake = 0;
	private due = false;

	constructor(private readonly opts: OrphanBoundOptions) {
		this.tick = Duration.min(TICK, Duration.ms(opts.bound.ms / 4));
		this.last = opts.clock.now().ms;
		this.ticking = opts.timer.setInterval(() => this.count(), this.tick);
	}

	private count(): void {
		const now = this.opts.clock.now().ms;
		const gap = now - this.last;
		this.last = now;
		const slept = gap > this.tick.ms * 2;
		this.awake += slept ? this.tick.ms : gap;
		if (slept) {
			this.opts.woke();
		}
		if (!this.due && this.awake >= this.opts.bound.ms) {
			this.due = true;
			this.opts.due();
		}
	}

	dispose(): void {
		this.ticking.dispose();
	}
}

/** What an `OrphanBound` counts against and tells. */
export interface OrphanBoundOptions {
	/** How long awake without a server before what it left ends. */
	bound: Duration;
	timer: Timer;
	clock: Clock;
	/** Called on waking from a sleep, to redial now. */
	woke: () => void;
	/** Called once, when the bound has passed awake. */
	due: () => void;
}
