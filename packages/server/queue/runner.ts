import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { TaskRecord } from "../board";
import type { AgentPick } from "../models";
import { taskName } from "./name";
import { canStart, queueOrder } from "./order";

/**
 * How often the queue is checked again, for a slot freed or a task gone with
 * no change seen, as from another tree.
 */
export const QUEUE_SWEEP = Duration.mins(1);

/** One queued task the queue starts, as `QueueRunner` hands it to its `start`. */
export interface QueueStart {
	queued: TaskRecord;
	/** The name for its task, one no task out has. */
	task: string;
	/** The agent and model to work it: the one it names, else the default. */
	pick: AgentPick;
	/** What its agent is told beyond claiming the task. */
	prompt: string;
}

/** A queued task that could start but finds no slot, and who would work it. */
export interface QueueWaiting {
	queued: TaskRecord;
	pick: AgentPick;
}

/**
 * Adds the task for `start`, handed to its agent, which `splates server`
 * starts as for any `splates add --agent`. Throws when the add is refused.
 */
export type QueueStarter = (start: QueueStart) => Promise<void>;

/**
 * Works the queue down: whenever a worker has a slot free, the first queued
 * task in queue order that nothing open blocks goes out as a task of its
 * own, on the agent and model it names, or the roster's first agent for one
 * that names none. As many go at once as there is room, so none waits for a
 * slot with its worktree made.
 *
 * Checked as tasks change, as workers' slots free, and every `QUEUE_SWEEP`.
 * A queued task whose start was refused is not tried again until it changes
 * or the server restarts, so a broken one never loops.
 */
export class QueueRunner implements Resource {
	readonly #disposer = new Disposer();
	/** One check at a time, so no queued task is started twice. */
	#checking = Promise.resolve();
	/** The queued tasks being started now, until their task takes them. */
	readonly #starting = new Set<number>();
	/** Each queued task whose start was refused, as it stood then, by id. */
	readonly #refused = new Map<number, string>();

	private constructor(
		private readonly deps: QueueRunnerDeps,
		timer: Timer,
	) {
		this.#disposer.use(timer.setInterval(() => this.sweep(), QUEUE_SWEEP));
	}

	/** Works the queue, checking it at once. */
	static watch({
		timer = new SystemTimer(),
		...deps
	}: QueueRunnerDeps & { timer?: Timer }): QueueRunner {
		const runner = new QueueRunner(deps, timer);
		runner.sweep();
		return runner;
	}

	/** Starts every queued task there is room for now. */
	sweep(): Promise<void> {
		const next = this.#checking.then(() => this.#check());
		this.#checking = next.catch((error: unknown) =>
			this.deps.log.error(`could not work the queue: ${String(error)}`),
		);
		return this.#checking;
	}

	async #check(): Promise<void> {
		const all = await this.deps.queued();
		for (const [id, was] of this.#refused) {
			const now = all.find((queued) => queued.id === id);
			if (now === undefined || JSON.stringify(now) !== was) {
				this.#refused.delete(id);
			}
		}
		const startable = queueOrder(all).filter(
			(queued) =>
				!this.#starting.has(queued.id) &&
				!this.#refused.has(queued.id) &&
				canStart(queued, all),
		);
		const room = Math.max(0, this.deps.room() - this.#starting.size);
		const next = startable.slice(0, room);
		if (startable.length === 0) {
			this.deps.want([]);
			return;
		}
		const fallback = await this.deps.fallback();
		// The rest wait for a slot, standing in the workers' line so one is
		// woken or made for them.
		this.deps.want(
			startable.slice(room).map((queued) => ({
				queued,
				pick: queued.assignee ?? fallback,
			})),
		);
		if (next.length === 0) {
			return;
		}
		const names = new Set(await this.deps.tasks());
		const starts: QueueStart[] = [];
		for (const queued of next) {
			const task = taskName(queued.subject, names);
			names.add(task);
			this.#starting.add(queued.id);
			starts.push({
				queued,
				task,
				pick: queued.assignee ?? fallback,
				prompt: queuePrompt(queued),
			});
		}
		// Each add readies a worktree, an install included, so neither another
		// start nor the next check waits on it: `#starting` holds its queued task.
		for (const start of starts) {
			void (async () => {
				try {
					await this.deps.start(start);
					this.deps.log.info(
						`the queue started task ${start.queued.id} as ${start.task}`,
					);
				} catch (error) {
					this.#refused.set(start.queued.id, JSON.stringify(start.queued));
					this.deps.log.error(
						`the queue could not start task ${start.queued.id} as ${start.task}, and leaves it until it changes: ${String(error)}`,
					);
				} finally {
					this.#starting.delete(start.queued.id);
				}
			})();
		}
	}

	dispose(): void {
		this.#disposer.dispose();
	}
}

/** What a `QueueRunner` works with. */
export interface QueueRunnerDeps {
	/** Every task on the list, queued or not. */
	queued: () => Promise<TaskRecord[]>;
	/** The name of every task out, so a new one takes another. */
	tasks: () => Promise<string[]>;
	/** How many more agents the workers could start now without waiting. */
	room: () => number;
	/**
	 * The queued tasks that could start but find no room, in queue order, to
	 * wait in the workers' line: each sweep says them all, none when none.
	 */
	want: (waiting: QueueWaiting[]) => void;
	/** Who works a queued task that names no model: the roster's first agent. */
	fallback: () => Promise<AgentPick>;
	start: QueueStarter;
	log: Logger;
}

/**
 * What a queued task's agent is told beyond claiming its task: that the
 * queue started it, and the commit each task it was blocked by landed as,
 * which it builds on.
 */
export function queuePrompt(queued: TaskRecord): string {
	return [
		`splates server started this task for queued task #${queued.id} from the queue: nothing it is blocked by is left open.`,
		...(queued.blockersLanded ?? []).map(
			(landed) =>
				`It was blocked by #${landed.id} ${landed.subject}, which landed as ${landed.commit}: \`git show ${landed.commit}\` for what it builds on.`,
		),
		"Groom it first, since nothing has yet: check no other task already asks it, link what it needs merged first with `splates task update <n> --blocked-by <n>`, and ask only what is hard to reverse. When it links a task still open, `splates remove` yours so the queue holds it until that lands.",
		"Work it as the splates skill says, ending in `splates merge`, `splates escalate` or `splates remove`.",
	].join("\n");
}
