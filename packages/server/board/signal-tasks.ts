import { fail } from "../exit";
import { checkName, dotted } from "../signals/book";
import { sinceOf } from "../signals/time";
import type { SignalRaise } from "../signals/types";
import type { ClosesOn, Firing, TaskRecord } from "./task";
import type { Tasks } from "./tasks";

/**
 * What `--closes-on <signal>` and `--since <time>` say, as a record: a
 * firing after `since`, by default after now, closes the task. A call such
 * as `clock.in("2 days")` is kept as written.
 */
export function closesOnFrom(
	signal: string,
	since: string,
	now: number,
): ClosesOn {
	const name = signal.includes("(") ? dotted(signal) : checkName(signal);
	return {
		signal: name,
		since: since === "" ? new Date(now).toISOString() : sinceOf(since, now),
	};
}

/** `--since` without `--closes-on` means nothing: refuse it rather than drop it. */
export function sinceNeedsSignal(closesOn: string, since: string): void {
	if (since !== "" && closesOn === "") {
		fail("usage", "--since says from when a firing counts: add --closes-on", {
			since,
		});
	}
}

/** The tasks of `states` that close on a signal, and have not yet closed. */
export function signalTasks(states: readonly TaskRecord[]): TaskRecord[] {
	return states.filter((each) => each.closesOn !== undefined);
}

/** What the board needs of the signal service to close tasks on firings. */
export interface SignalTaskDeps {
	tasks: Tasks;
	/** Every raise of the last week, by signal name, oldest first. */
	raises(): Promise<Record<string, SignalRaise[]>>;
	/** Something began to subscribe to `name`: its probe runs now. */
	subscribed(name: string): Promise<void>;
	log: { error(message: string): void };
}

/**
 * Closes board tasks on signals. Call `sweep` after a task or a signal
 * changes, and ask `on` or `list` which tasks wait on which signal.
 */
export class SignalTasks {
	readonly #known = new Set<string>();
	#sweeping: Promise<void> = Promise.resolve();

	constructor(private readonly deps: SignalTaskDeps) {}

	/** How many open tasks close on `name`. */
	async on(name: string): Promise<number> {
		const wanted = dotted(name);
		return signalTasks(await this.deps.tasks.stored()).filter(
			(each) => dotted(each.closesOn?.signal ?? "") === wanted,
		).length;
	}

	/** Every open task that closes on a signal, with the signal's name. */
	async list(): Promise<{ id: number; subject: string; signal: string }[]> {
		return signalTasks(await this.deps.tasks.stored()).map((each) => ({
			id: each.id,
			subject: each.subject,
			signal: dotted(each.closesOn?.signal ?? ""),
		}));
	}

	/** Ends each open task whose signal was fired after its `since`, and starts the probe of each other one's signal once. */
	sweep(): Promise<void> {
		this.#sweeping = this.#sweeping
			.then(() => this.#close())
			.catch((error) => {
				this.deps.log.error(`closing tasks on signals: ${String(error)}`);
			});
		return this.#sweeping;
	}

	async #close(): Promise<void> {
		const open = signalTasks(await this.deps.tasks.stored());
		const raises = await this.deps.raises();
		for (const task of open) {
			const closesOn = task.closesOn as ClosesOn;
			const name = dotted(closesOn.signal);
			const fired = (raises[name] ?? []).findLast(
				(each) => each.at > closesOn.since,
			);
			if (fired === undefined) {
				if (!this.#known.has(name)) {
					this.#known.add(name);
					await this.deps.subscribed(name).catch((error: unknown) => {
						this.deps.log.error(`probing ${name}: ${String(error)}`);
					});
				}
				continue;
			}
			const firing: Firing = {
				signal: name,
				at: fired.at,
				payload: fired.payload,
			};
			await (await this.deps.tasks.find(task.id)).remove(firing);
		}
	}
}
