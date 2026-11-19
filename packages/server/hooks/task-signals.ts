import type { Resource } from "core/disposable";
import type { Logger } from "core/log";
import { Duration, SystemTimer, Throttler, type Timer } from "core/time";
import type { Journal } from "../records";
import { type TaskEvent, taskEventsOf } from "./events";

/** What `TaskSignals` works with. */
export interface TaskSignalsDeps {
	journal: Journal;
	log: Logger;
	/** Raises `event` as a signal, so a conversation can wait on it and an automation can trigger on it. */
	raise: (event: TaskEvent) => Promise<void>;
	timer?: Timer;
}

/**
 * Raises each task event as the journal takes it as a signal, in the order
 * it took them. It starts from now: what the journal held when it began, or
 * took while the server was down, raises nothing.
 */
export class TaskSignals implements Resource {
	readonly #seen = new Set<string>();
	readonly #throttler: Throttler;
	#reading = Promise.resolve();
	#watching: Resource | null = null;

	private constructor(
		private readonly deps: TaskSignalsDeps,
		timer: Timer,
	) {
		this.#throttler = new Throttler(timer, BEAT);
	}

	/** Follows the journal, raising each task event it takes from now on. */
	static async follow({
		timer = new SystemTimer(),
		...deps
	}: TaskSignalsDeps): Promise<TaskSignals> {
		const signals = new TaskSignals(deps, timer);
		for (const event of await deps.journal.recent()) {
			signals.#seen.add(event.id);
		}
		try {
			const watching = deps.journal.watch();
			watching.events.on("changed", () => void signals.changed());
			signals.#watching = watching;
			// Anything logged between the read above and the watch starting.
			await signals.changed();
		} catch (error) {
			deps.log.error(
				`splates server cannot watch its journal, so task events are not raised as signals: ${String(error)}`,
			);
		}
		return signals;
	}

	/** Raises what the journal took since the last look; settles once it has. */
	changed(): Promise<void> {
		this.#throttler.call(() => {
			this.#reading = this.#reading
				.then(() => this.#take())
				.catch((error: unknown) => this.deps.log.error(String(error)));
		});
		return this.#reading;
	}

	dispose(): void {
		this.#watching?.dispose();
		this.#throttler.dispose();
	}

	async #take(): Promise<void> {
		const fresh = (await this.deps.journal.recent()).filter(
			(event) => !this.#seen.has(event.id),
		);
		for (const event of fresh) {
			this.#seen.add(event.id);
		}
		for (const event of fresh.flatMap(taskEventsOf)) {
			await this.deps
				.raise(event)
				.catch((error: unknown) =>
					this.deps.log.error(
						`${event.name} could not be raised: ${String(error)}`,
					),
				);
		}
	}
}

/** How soon after one read the next may run, while an agent's commands come quickly. */
const BEAT = Duration.ms(50);
