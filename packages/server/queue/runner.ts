import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { TaskRecord } from "../board";
import type { QueueSpot } from "../conversations";
import type { AgentPick } from "../models";
import { taskName } from "./name";
import { canStart, holdsBack, queueOrder } from "./order";

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
	/** The conversation held for it, which takes the task; absent for none. */
	held?: string;
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
 * A lane the person queued whole has each of its tasks queued as soon as
 * nothing blocks it, first thing in each check, until no task is left in it.
 *
 * Checked as tasks change, as workers' slots free, and every `QUEUE_SWEEP`.
 * A queued task whose start was refused is not tried again until it changes,
 * the person asks (`retry`), or the server restarts, so a broken one never
 * loops; its held conversation says why it was refused meanwhile.
 */
export class QueueRunner implements Resource {
	readonly #disposer = new Disposer();
	/** One check at a time, so no queued task is started twice. */
	#checking = Promise.resolve();
	/** The queued tasks being started now, until their task takes them. */
	readonly #starting = new Set<number>();
	/**
	 * Each queued task whose start was refused, by id: as it stood then, and
	 * why.
	 */
	readonly #refused = new Map<number, { was: string; why: string }>();
	/**
	 * When each queued task was first placed as starting, by id, so its held
	 * conversation says how long the start has taken, not the queue.
	 */
	readonly #startingSince = new Map<number, string>();
	/** The pick each held conversation was made on, by its id, while this runs. */
	readonly #picks = new Map<string, string>();

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

	/** Tries queued task `id` again, its start refused, as though it changed. */
	retry(id: number): Promise<void> {
		this.#refused.delete(id);
		return this.sweep();
	}

	async #check(): Promise<void> {
		await this.deps.lanes?.();
		const all = await this.deps.queued();
		for (const [id, { was }] of this.#refused) {
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
		const fallback =
			queueOrder(all).length === 0 ? null : await this.deps.fallback();
		const held =
			this.deps.held === undefined
				? new Map<number, string>()
				: await this.#hold(this.deps.held, all, fallback, next);
		if (startable.length === 0 || fallback === null) {
			this.deps.want([]);
			return;
		}
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
				...(held.has(queued.id) ? { held: held.get(queued.id) } : {}),
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
					this.#refused.set(start.queued.id, {
						was: JSON.stringify(start.queued),
						why: refusal(error),
					});
					this.deps.log.error(
						`the queue could not start task ${start.queued.id} as ${start.task}, and leaves it until it changes: ${String(error)}`,
					);
					// Its held conversation says so now, not at the next sweep;
					// the check runs after `finally`, so it is no longer starting.
					void this.sweep();
				} finally {
					this.#starting.delete(start.queued.id);
				}
			})();
		}
	}

	/**
	 * Gives each queued task a held conversation, places each in the queue,
	 * and drops those whose task left it, was taken another way, or now names
	 * another agent or model; answers the held one of each, by queued task.
	 */
	async #hold(
		conversations: HeldConversations,
		all: readonly TaskRecord[],
		/** Who works one that names no model; null while none is queued. */
		fallback: AgentPick | null,
		next: readonly TaskRecord[],
	): Promise<Map<number, string>> {
		const queue = queueOrder(all);
		const listed = await conversations.list();
		const kept = new Map<number, HeldConversation>();
		for (const each of listed) {
			const task = all.find((queued) => queued.id === each.queued);
			const busy = this.#starting.has(each.queued) || each.handed;
			const pick = task?.assignee ?? fallback;
			const was = this.#picks.get(each.id);
			const gone =
				task === undefined ||
				task.stage !== "queued" ||
				(task.takenBy !== null && !busy) ||
				(!busy &&
					pick !== null &&
					(pick.agent !== each.agent ||
						(was !== undefined && was !== JSON.stringify(pick)))) ||
				kept.has(each.queued);
			if (gone && !busy) {
				this.#picks.delete(each.id);
				await conversations.drop(each.id);
			} else {
				kept.set(each.queued, each);
			}
		}
		for (const queued of queue) {
			const pick = queued.assignee ?? fallback;
			if (!kept.has(queued.id) && pick !== null) {
				await conversations.hold(queued, pick);
			}
		}
		const held = new Map<number, string>();
		const now = await conversations.list();
		for (const id of this.#picks.keys()) {
			if (!now.some((each) => each.id === id)) {
				this.#picks.delete(id);
			}
		}
		for (const each of now) {
			const at = queue.findIndex((queued) => queued.id === each.queued);
			const queued = queue[at];
			if (queued === undefined) {
				continue;
			}
			if (!this.#picks.has(each.id)) {
				this.#picks.set(each.id, JSON.stringify(queued.assignee ?? fallback));
			}
			held.set(each.queued, each.id);
			const reason = waitsFor(
				queued,
				all,
				next.includes(queued),
				this.#refused.get(queued.id)?.why,
			);
			if (reason !== "starting") {
				this.#startingSince.delete(queued.id);
			} else if (!this.#startingSince.has(queued.id)) {
				this.#startingSince.set(queued.id, new Date().toISOString());
			}
			conversations.place(each.id, {
				position: at + 1,
				of: queue.length,
				since: this.#startingSince.get(queued.id) ?? each.createdAt,
				reason,
			});
		}
		return held;
	}

	dispose(): void {
		this.#disposer.dispose();
	}
}

/**
 * Why queued task `queued` has yet to start, among `all`: its start
 * `refused`, what it waits on, or a free slot, unless it is `next`, starting
 * now.
 */
function waitsFor(
	queued: TaskRecord,
	all: readonly TaskRecord[],
	next: boolean,
	refused: string | undefined,
): string {
	if (refused !== undefined) {
		return `could not start: ${refused}`;
	}
	const { open, lost } = holdsBack(queued, all);
	if (lost.length > 0) {
		return `needs you: ${lost.map((id) => `#${id}`).join(", ")} was removed`;
	}
	if (open.length > 0) {
		return `waits on ${open.map((other) => `#${other.id}`).join(", ")}`;
	}
	return next ? "starting" : "no free slot";
}

/** Why a start was refused, in its error's first line. */
function refusal(error: unknown): string {
	const said = error instanceof Error ? error.message : String(error);
	return said.trim().split("\n")[0] || "it was refused";
}

/** What a `QueueRunner` works with. */
export interface QueueRunnerDeps {
	/** Every task on the list, queued or not. */
	queued: () => Promise<TaskRecord[]>;
	/**
	 * Queues each task of a lane queued whole that can start now, before
	 * each check reads the list; absent, no lane is queued whole.
	 */
	lanes?: () => Promise<unknown>;
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
	/** The conversations held for queued tasks; absent, none is held. */
	held?: HeldConversations;
	log: Logger;
}

/** A conversation held for a queued task, as `HeldConversations` lists it. */
export interface HeldConversation {
	id: string;
	/** The queued task it is held for. */
	queued: number;
	agent: string;
	createdAt: string;
	/** Whether a task the queue started names it, to take it. */
	handed: boolean;
}

/**
 * The conversations held for queued tasks, one for each from the moment it
 * is queued, so the person sees it waiting: out of the line for a slot,
 * which only the queue's starts join, until the queue starts its task.
 */
export interface HeldConversations {
	/** Every one held, or made held and not yet given its task. */
	list: () => Promise<HeldConversation[]>;
	/** Makes one held for `queued`, on `pick`. */
	hold: (queued: TaskRecord, pick: AgentPick) => Promise<void>;
	/** Says where `id` stands in the queue, holding it again once stopped. */
	place: (id: string, spot: QueueSpot) => void;
	/** Archives `id`, its task gone from the queue, or taken another way. */
	drop: (id: string) => Promise<void>;
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
		"Work it as the splates skill says, ending in `splates merge` or `splates remove`, or in questions for the user.",
	].join("\n");
}
