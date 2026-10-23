import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	type Clock,
	Duration,
	SystemClock,
	SystemTimer,
	type Timer,
} from "webappwiz/time";

/** Leaves evidence of a delayed event loop beside the worker's missed heartbeats. */
export class LoopWatch implements Resource {
	private readonly interval: Resource;

	constructor(
		log: Logger,
		{
			clock = new SystemClock(),
			timer = new SystemTimer(),
		}: {
			clock?: Clock;
			timer?: Timer;
		} = {},
	) {
		let last = clock.now();
		this.interval = timer.setInterval(() => {
			const now = clock.now();
			const late = now.subtract(last).subtract(EVERY);
			last = now;
			if (late.isGreaterThan(WARN_AFTER)) {
				log.error(`splates server event loop delayed by ${late.secs}s`);
			}
		}, EVERY);
	}

	dispose(): void {
		this.interval.dispose();
	}
}

const EVERY = Duration.secs(1);
const WARN_AFTER = Duration.secs(5);
