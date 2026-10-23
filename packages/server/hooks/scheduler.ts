import type { Resource } from "webappwiz/disposable";
import {
	Duration,
	SystemTimer,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import { type FireDeps, fire } from "./runner";
import { scheduleOf } from "./schedule";
import type { Automation } from "./store";

/**
 * Runs each scheduled automation as it comes due, looking once a minute.
 * When it came due more than once since its last run, as while
 * `splates server` was down, it runs once, not once per miss. One the
 * person asked to run now runs once for each request, its schedule left be.
 */
export class Scheduler implements Resource {
	readonly #ticking: Resource;
	#looking = Promise.resolve();

	private constructor(
		private readonly deps: SchedulerDeps,
		timer: Timer,
	) {
		this.#ticking = timer.setInterval(() => void this.look(), TICK);
	}

	/** Runs what came due while it was down, then looks again each minute. */
	static async start({
		timer = new SystemTimer(),
		...deps
	}: SchedulerDeps & { timer?: Timer }): Promise<Scheduler> {
		const scheduler = new Scheduler(deps, timer);
		await scheduler.look();
		return scheduler;
	}

	/** Runs each automation due now; settles once they ran. */
	look(): Promise<void> {
		this.#looking = this.#looking
			.then(() => this.#take())
			.catch((error: unknown) => this.deps.log.error(String(error)));
		return this.#looking;
	}

	dispose(): void {
		this.#ticking.dispose();
	}

	async #take(): Promise<void> {
		const now = this.deps.clock.now();
		const runs = await this.deps.runs.read();
		for (const automation of await this.deps.automations()) {
			const { trigger, requestedAt } = automation;
			// Asked for by the person, so it runs paused too.
			if (
				requestedAt !== undefined &&
				requestedAt !== runs[automation.id]?.requestedAt
			) {
				await this.deps.runs.requested(automation.id, requestedAt);
				await fire(
					automation,
					{ schedule: automation.id, byHand: true },
					this.deps,
				);
			}
			if (automation.paused === true || "event" in trigger) {
				continue;
			}
			let due: number;
			try {
				// An edited schedule counts from the edit, not a run on the old one.
				const last = Math.max(
					Date.parse(runs[automation.id]?.scheduledAt ?? automation.createdAt),
					Date.parse(automation.editedAt ?? automation.createdAt),
				);
				due = scheduleOf(trigger).nextAfter(last);
			} catch (error) {
				this.deps.log.error(
					`automation ${automation.id} has a schedule that will not read: ${String(error)}`,
				);
				continue;
			}
			if (due > now) {
				continue;
			}
			// Kept before it runs, so a crash mid-run never runs it twice.
			await this.deps.runs.scheduled(
				automation.id,
				new Date(now).toISOString(),
			);
			await fire(automation, { schedule: automation.id }, this.deps);
		}
	}
}

/** What a `Scheduler` works with. */
export interface SchedulerDeps extends FireDeps {
	/** Every automation set now. */
	automations: () => Promise<Automation[]>;
	clock: WallClock;
}

/** How often it looks for an automation come due: cron's own step. */
const TICK = Duration.mins(1);
