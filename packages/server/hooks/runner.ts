import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, Throttler, type Timer } from "webappwiz/time";
import type { TaskStage } from "../board";
import type { Journal } from "../records";
import type { Document, Storage } from "../storage";
import { type TaskEvent, taskEventsOf } from "./events";
import type { AutomationRun, RunStore } from "./runs";
import type { Automation, Hook, TaskFilter } from "./store";

/** What set an automation off: a task event, or its schedule coming due. */
export type Fired = { event: TaskEvent } | { schedule: string };

/** What a hook does, by kind. */
export interface HookActions {
	run(command: string, fired: Fired): Promise<void>;
	agent(hook: Extract<Hook, { kind: "agent" }>, fired: Fired): Promise<void>;
	/** Wakes the project's groomer, which the state, not `fired`, tells what to groom. */
	groom(hook: Extract<Hook, { kind: "groom" }>): Promise<void>;
	/** Starts an agent auditing the project notes no open task names yet. */
	audit(hook: Extract<Hook, { kind: "audit" }>): Promise<void>;
}

/** Runs `automation`'s hook for `fired`, keeping the run, and logging a failure rather than throwing it. */
export async function fire(
	automation: Automation,
	fired: Fired,
	{ actions, runs, log, now }: FireDeps,
): Promise<void> {
	const on = "event" in fired ? said(fired.event) : "schedule";
	const run: AutomationRun = { at: now(), on, error: null };
	const { hook } = automation;
	try {
		if (hook.kind === "run") {
			await actions.run(hook.command, fired);
		} else if (hook.kind === "agent") {
			await actions.agent(hook, fired);
		} else if (hook.kind === "groom") {
			await actions.groom(hook);
		} else if (hook.kind === "audit") {
			await actions.audit(hook);
		}
	} catch (error) {
		run.error = String(error);
		log.error(`a ${hook.kind} hook on ${on} failed: ${String(error)}`);
	}
	await runs
		.ran(automation.id, run)
		.catch((error: unknown) => log.error(String(error)));
}

/** What `fire` works with. */
export interface FireDeps {
	actions: HookActions;
	runs: RunStore;
	log: Logger;
	/** The time now, as an ISO string. */
	now: () => string;
}

/** `event` as a run lists it: `task.created #3`. */
function said(event: TaskEvent): string {
	return [
		event.name,
		...event.numbers.map((id) => `#${id}`),
		...(event.task === null ? [] : [event.task]),
	].join(" ");
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
	readonly #seenAt: Document<Seen>;

	private constructor(
		private readonly deps: HookRunnerDeps,
		timer: Timer,
	) {
		this.#throttler = new Throttler(timer, BEAT);
		this.#seenAt = deps.storage.document("hooks-seen.json");
	}

	/** Runs hooks for each task event from where it got to, then follows the journal for more. */
	static async follow({
		timer = new SystemTimer(),
		...deps
	}: HookRunnerDeps & { timer?: Timer }): Promise<HookRunner> {
		const runner = new HookRunner(deps, timer);
		await runner.#take();
		try {
			const watching = deps.storage.watch("");
			watching.events.on("changed", () => void runner.changed());
			runner.#watching = watching;
			// Anything logged between the read above and the watch starting.
			await runner.changed();
		} catch (error) {
			deps.log.error(
				`splates server cannot watch the project's records, so hooks run only as it starts: ${String(error)}`,
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
		const automations = await this.deps.automations();
		for (const event of fresh.flatMap(taskEventsOf)) {
			for (const automation of automations) {
				const { trigger } = automation;
				if (
					automation.paused === true ||
					!("event" in trigger) ||
					trigger.event !== event.name
				) {
					continue;
				}
				const matching = await this.#matching(event, trigger.filter);
				if (matching !== null) {
					await fire(automation, { event: matching }, this.deps);
				}
			}
		}
		await this.#write(last?.at ?? null, events);
	}

	/**
	 * `event` narrowed to the tasks `filter` matches, as each stands now, or
	 * null when it matches none. One about no task left on the list, as a
	 * finished one, matches no filter.
	 */
	async #matching(
		event: TaskEvent,
		filter: TaskFilter | undefined,
	): Promise<TaskEvent | null> {
		if (
			filter === undefined ||
			(filter.stages === undefined && filter.lanes === undefined)
		) {
			return event;
		}
		const numbers: number[] = [];
		for (const id of event.numbers) {
			const task = await this.deps.task(id);
			if (
				task !== null &&
				(filter.stages === undefined || filter.stages.includes(task.stage)) &&
				(filter.lanes === undefined ||
					(task.lane !== null && filter.lanes.includes(task.lane)))
			) {
				numbers.push(id);
			}
		}
		return numbers.length === 0 ? null : { ...event, numbers };
	}

	async #seen(): Promise<Seen | null> {
		return this.#seenAt.read().catch(() => null);
	}

	/** Keeps that every event up to `at` ran, with the ids at `at`, which share it. */
	async #write(
		at: string | null,
		events: readonly { at: string; id: string }[],
	): Promise<void> {
		const ids = events.filter((each) => each.at === at).map(({ id }) => id);
		await this.#seenAt.write({ at, ids });
	}
}

/** What a `HookRunner` works with. */
export interface HookRunnerDeps extends FireDeps {
	journal: Journal;
	/**
	 * The project's, where the journal writes, watched for more, and where
	 * `hooks-seen.json` keeps how far it got, past a restart.
	 */
	storage: Storage;
	/** Every automation set now: the person's, and the shell hooks the project checks in. */
	automations: () => Promise<Automation[]>;
	/** Queued task `id`'s stage and lane now, or null for one off the list, for filters. */
	task: (
		id: number,
	) => Promise<{ stage: TaskStage; lane: number | null } | null>;
}

/** How far the runner got: the time of the last event it took, and the ids at that time. */
interface Seen {
	at: string | null;
	ids: string[];
}

/** How soon after one read the next may run, while an agent's commands come quickly. */
const BEAT = Duration.ms(50);
