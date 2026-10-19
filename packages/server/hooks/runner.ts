import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { Duration, SystemTimer, Throttler, type Timer } from "webappwiz/time";
import type { Journal } from "../records";
import { type TaskEvent, taskEventsOf } from "./events";
import type { Hook, Hooks } from "./store";

/** What a hook does, by kind. */
export interface HookActions {
	run(command: string, event: TaskEvent): Promise<void>;
	agent(
		hook: Extract<Hook, { kind: "agent" }>,
		event: TaskEvent,
	): Promise<void>;
}

/**
 * Runs the hooks set for each task event as the journal takes it, in the
 * order it took them. Where it got to is kept in `seen`, so after a restart
 * it catches up on what it missed; the first time, it starts from now
 * rather than run hooks for the whole past.
 */
export class HookRunner implements Resource {
	readonly #throttler: Throttler;
	#reading = Promise.resolve();
	#watching: Resource | null = null;

	private constructor(
		private readonly deps: HookRunnerDeps,
		timer: Timer,
	) {
		this.#throttler = new Throttler(timer, BEAT);
	}

	/** Runs hooks for each task event from where it got to, then follows the journal for more. */
	static async follow({
		timer = new SystemTimer(),
		...deps
	}: HookRunnerDeps & { timer?: Timer }): Promise<HookRunner> {
		const runner = new HookRunner(deps, timer);
		await runner.#take();
		try {
			runner.#watching = deps.fs.watch(deps.splatesDir, () => runner.changed());
			// Anything logged between the read above and the watch starting.
			await runner.changed();
		} catch (error) {
			deps.log.error(
				`splates server cannot watch ${deps.splatesDir}, so hooks run only as it starts: ${String(error)}`,
			);
		}
		return runner;
	}

	/** Runs hooks for what the journal took since the last look; settles once they ran. */
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
		const events = await this.deps.journal.recent();
		const seen = await this.#seen();
		const last = events.at(-1);
		if (seen === null) {
			await this.#write(last === undefined ? null : last.at, events);
			return;
		}
		const fresh = events.filter(
			(event) =>
				seen.at === null ||
				event.at > seen.at ||
				(event.at === seen.at && !seen.ids.includes(event.id)),
		);
		if (fresh.length === 0) {
			return;
		}
		const hooks = await this.deps.hooks();
		for (const event of fresh.flatMap(taskEventsOf)) {
			for (const hook of hooks[event.name] ?? []) {
				await this.#run(hook, event);
			}
		}
		await this.#write(last?.at ?? null, events);
	}

	async #run(hook: Hook, event: TaskEvent): Promise<void> {
		const about = `${event.name}${event.numbers.map((id) => ` #${id}`).join("")}`;
		try {
			if (hook.kind === "run") {
				await this.deps.actions.run(hook.command, event);
			} else if (hook.kind === "agent") {
				await this.deps.actions.agent(hook, event);
			}
		} catch (error) {
			this.deps.log.error(
				`a ${hook.kind} hook on ${about} failed: ${String(error)}`,
			);
		}
	}

	async #seen(): Promise<{ at: string | null; ids: string[] } | null> {
		const raw = await this.deps.fs.read(this.deps.seen).catch(() => null);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as { at: string | null; ids: string[] };
		} catch {
			return null;
		}
	}

	/** Keeps that every event up to `at` ran, with the ids at `at`, which share it. */
	async #write(
		at: string | null,
		events: readonly { at: string; id: string }[],
	): Promise<void> {
		const ids = events.filter((each) => each.at === at).map(({ id }) => id);
		await this.deps.fs.write(this.deps.seen, JSON.stringify({ at, ids }));
	}
}

/** What a `HookRunner` works with. */
export interface HookRunnerDeps {
	journal: Journal;
	fs: Fs;
	/** Where the journal writes, watched for more. */
	splatesDir: string;
	/** Every hook set now: the person's, and the shell ones the project checks in. */
	hooks: () => Promise<Hooks>;
	/** Where it got to, kept past a restart. */
	seen: string;
	actions: HookActions;
	log: Logger;
}

/** How soon after one read the next may run, while an agent's commands come quickly. */
const BEAT = Duration.ms(50);
