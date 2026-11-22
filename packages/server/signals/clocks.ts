import type { Resource } from "core/disposable";
import { Duration, type Timer } from "core/time";
import type { SignalBook } from "./book";
import { callOf, STANDARD_SIGNAL_FUNCTIONS } from "./call";
import { clockNext, newClock, type SignalClock } from "./clock-schedule";

/** Start clock signals with `start`, then call `arm` to raise them while subscribed. Dispose on shutdown. */
export class Clocks {
	private timer?: Resource;
	private running: Promise<void> = Promise.resolve();
	private disposed = false;
	constructor(
		private readonly deps: {
			book: SignalBook;
			now(): number;
			timer: Timer;
			active(): Promise<string[]>;
			raise(name: string, by: string, payload: unknown): Promise<void>;
			error(error: unknown): void;
		},
	) {}
	async start(name: string): Promise<SignalClock> {
		const prior = (await this.deps.book.clocks()).find(
			(each) => each.name === name,
		);
		if (prior) {
			return prior;
		}
		const call = callOf(name, STANDARD_SIGNAL_FUNCTIONS);
		const clock = newClock(name, call.fn, call.args, this.deps.now());
		await this.deps.book.keepClock(clock);
		return clock;
	}
	/** Check subscribed clocks and raise those due; await this to run a check without arming the timer. */
	tick(): Promise<void> {
		const run = this.running.then(() => this.scan());
		this.running = run.catch(this.deps.error);
		return run;
	}
	arm(): void {
		const run = () => {
			void this.tick()
				.finally(() => {
					if (!this.disposed) {
						this.timer = this.deps.timer.setTimeout(run, Duration.secs(1));
					}
				})
				.catch(() => {});
		};
		run();
	}
	dispose(): void {
		this.disposed = true;
		this.timer?.dispose();
	}
	private async scan(): Promise<void> {
		if (this.disposed) {
			return;
		}
		const names = new Set(
			(await this.deps.active()).filter((name) => name.startsWith("clock.")),
		);
		for (const name of names) {
			if (this.disposed) {
				return;
			}
			const clock = await this.start(name);
			if (clock.next === null || Date.parse(clock.next) > this.deps.now()) {
				continue;
			}
			const scheduled = clock.next;
			const call = callOf(name, STANDARD_SIGNAL_FUNCTIONS);
			const next = clock.recurring
				? clockNext(
						call.fn,
						call.args,
						Date.parse(clock.startedAt),
						this.deps.now(),
					)
				: null;
			clock.next =
				next === null || !Number.isFinite(next)
					? null
					: new Date(next).toISOString();
			// Save the cursor before delivery so a restart cannot replay a missed interval repeatedly.
			await this.deps.book.keepClock(clock);
			await this.deps.raise(name, "clock", {
				scheduledAt: scheduled,
				timeZone: clock.tz,
			});
		}
	}
}
