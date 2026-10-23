import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { TaskRecord } from "../board";
import type { QueueSpot } from "../conversations";
import type { AgentPick } from "../models";
import { taskName } from "./name";
import { canStart, queueOrder, stalled } from "./order";

/**
 * How often the queue is checked again, for a slot freed or a task gone with
 * no change seen, as from another tree.
 */
export const QUEUE_SWEEP = Duration.mins(1);

/**
 * The most sweeps a refused start waits before it is tried again, its wait
 * doubling from one sweep with each refusal until it reaches this.
 */
export const RETRY_SWEEPS_MAX = 30;

/** One queued task the queue starts, as `QueueRunner` hands it to its `start`. */
export interface QueueStart {
	queued: TaskRecord;
	/** The name for its task, one no task out has. */
	task: string;
	/** The agent and model to work it: the one it names, else what Auto pick decided. */
	pick: AgentPick;
	/** What its agent is told beyond claiming the task. */
	prompt: string;
	/** The conversation held for it, which takes the task; absent for none. */
	held?: string;
}

/**
 * Adds the task for `start`, handed to its agent, which `splates server`
 * starts as for any `splates add --agent`. Throws when the add is refused.
 */
export type QueueStarter = (start: QueueStart) => Promise<void>;

/**
 * Works the queue down: every queued task that nothing open blocks goes out, in queue order, as a task of its
 * own, on the agent and model it names, or for one that names none, what
 * the `picker`, Auto pick, decides as it starts. Queue starts take no slot, so all
 * go at once.
 *
 * A lane the person queued whole has each of its tasks queued as soon as
 * nothing blocks it, first thing in each check, until no task is left in it.
 *
 * A queued task waits on its blockers only while each is queued or running:
 * one blocked by a task neither is, or by one removed without merging,
 * would wait for good, so the queue lets it go back to ready, noting which
 * blockers to queue first. A task gets a held conversation only once it
 * can start, so none waits at an agent on another task.
 *
 * Checked as tasks change and every `QUEUE_SWEEP`.
 * A queued task whose start was refused is tried again at once when it
 * changes or the person asks (`retry`), and otherwise after a wait that
 * doubles with each refusal, up to `RETRY_SWEEPS_MAX` sweeps, so a passing
 * snag never strands it and a broken one never loops; its held
 * conversation says why it was refused meanwhile. What Auto pick keeps on a
 * task's record is not such a change.
 */
export class QueueRunner implements Resource {
	readonly #disposer = new Disposer();
	/** One check at a time, so no queued task is started twice. */
	#checking = Promise.resolve();
	/** The queued tasks being started now, until their task takes them. */
	readonly #starting = new Set<number>();
	/**
	 * Each queued task whose start was refused, by id: as it stood then, why,
	 * how many times in a row, and the sweeps it has waited since; `due` once
	 * it has waited enough to be tried again.
	 */
	readonly #refused = new Map<number, Refused>();
	/**
	 * When each queued task was first placed as starting, by id, so its held
	 * conversation says how long the start has taken, not the queue.
	 */
	readonly #startingSince = new Map<number, string>();
	/** The pick each held conversation was made on, by its id, while this runs. */
	readonly #heldOn = new Map<string, string>();

	private constructor(
		private readonly deps: QueueRunnerDeps,
		timer: Timer,
	) {
		this.#disposer.use(
			timer.setInterval(() => {
				this.#waitOut();
				void this.sweep();
			}, QUEUE_SWEEP),
		);
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

	/** Starts every queued task nothing blocks now. */
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

	/** Counts a sweep against each refused start, making those waited out due. */
	#waitOut(): void {
		for (const refused of this.#refused.values()) {
			refused.waited += 1;
			if (refused.waited >= retryAfter(refused.tries)) {
				refused.due = true;
			}
		}
	}

	async #check(): Promise<void> {
		await this.deps.lanes?.();
		let all = await this.deps.queued();
		const going = stalled(all);
		if (going.size > 0) {
			await this.deps.unqueue(going);
			all = await this.deps.queued();
		}
		for (const [id, { was }] of this.#refused) {
			const now = all.find((queued) => queued.id === id);
			if (now === undefined || asWas(now) !== was) {
				this.#refused.delete(id);
			}
		}
		const startable = queueOrder(all).filter(
			(queued) =>
				!this.#starting.has(queued.id) &&
				this.#refused.get(queued.id)?.due !== false &&
				canStart(queued, all),
		);
		// Paused, nothing starts, though each held conversation still says why
		// it waits; the scheduler's change on resume sweeps again.
		const paused = this.deps.paused?.() === true;
		const next = paused ? [] : startable;
		const picks = await this.#picks(all, next);
		const held =
			this.deps.held === undefined
				? new Map<number, string>()
				: await this.#hold(this.deps.held, all, picks.of, paused);
		if (next.length === 0) {
			return;
		}
		const names = new Set(await this.deps.tasks());
		const starts: (QueueStart & { decided?: QueuePicked })[] = [];
		for (const queued of next) {
			const task = taskName(queued, names);
			names.add(task);
			this.#starting.add(queued.id);
			starts.push({
				queued,
				task,
				pick: picks.of(queued),
				prompt: queuePrompt(queued),
				...(held.has(queued.id) ? { held: held.get(queued.id) } : {}),
				...(picks.decided.has(queued.id)
					? { decided: picks.decided.get(queued.id) }
					: {}),
			});
		}
		// Each add readies a worktree, an install included, so neither another
		// start nor the next check waits on it: `#starting` holds its queued task.
		for (const { decided, ...start } of starts) {
			void (async () => {
				try {
					// Said in its held conversation before its agent opens there.
					if (decided !== undefined && start.held !== undefined) {
						await decided.tell(start.held);
					}
					await this.deps.start(start);
					this.#refused.delete(start.queued.id);
					this.deps.log.info(
						`the queue started task ${start.queued.id} as ${start.task}`,
					);
				} catch (error) {
					const tries = (this.#refused.get(start.queued.id)?.tries ?? 0) + 1;
					this.#refused.set(start.queued.id, {
						was: asWas(start.queued),
						why: refusal(error),
						tries,
						waited: 0,
						due: false,
					});
					this.deps.log.error(
						`the queue could not start task ${start.queued.id} as ${start.task}, and tries it again in ${retryAfter(tries)} sweeps or once it changes: ${String(error)}`,
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
	 * Whom each queued task goes to: the agent it names, else Auto pick's
	 * pick. Every task in the backlog or the queue that names none has its
	 * words judged in the background as it is added and once for each new
	 * wording, so the queued ones take what that judged, guessed without
	 * asking again; those about to start, `next`, are decided now on fresh
	 * plan limits. A ready task is left until it is queued.
	 */
	async #picks(
		all: readonly TaskRecord[],
		next: readonly TaskRecord[],
	): Promise<{
		of: (queued: TaskRecord) => AgentPick;
		decided: Map<number, QueuePicked>;
	}> {
		const waiting = all.filter(
			(task) =>
				(task.stage === "backlog" || task.stage === "queued") &&
				task.takenBy === null &&
				task.assignee === undefined,
		);
		if (waiting.length > 0) {
			await this.deps.picker.ahead(waiting);
		}
		const unnamed = queueOrder(all).filter(
			(queued) => queued.assignee === undefined,
		);
		const decided = new Map<number, QueuePicked>();
		if (unnamed.length === 0) {
			return { of: (queued) => queued.assignee ?? NO_PICK, decided };
		}
		const guessed = await this.deps.picker.guess(unnamed);
		await Promise.all(
			next
				.filter((queued) => queued.assignee === undefined)
				.map(async (queued) => {
					decided.set(queued.id, await this.deps.picker.decide(queued));
				}),
		);
		return {
			of: (queued) =>
				queued.assignee ??
				decided.get(queued.id)?.pick ??
				guessed.get(queued.id) ??
				NO_PICK,
			decided,
		};
	}

	/**
	 * Gives each queued task that can start a held conversation, places each
	 * in the queue, and drops those whose task left it, was taken another
	 * way, waits on a blocker again, or now names another agent or model;
	 * answers the held one of each, by queued task.
	 */
	async #hold(
		conversations: HeldConversations,
		all: readonly TaskRecord[],
		/** Who works each, as `#picks` says. */
		pickOf: (queued: TaskRecord) => AgentPick,
		/** Whether the queue is paused, so what would start waits instead. */
		paused: boolean,
	): Promise<Map<number, string>> {
		const queue = queueOrder(all);
		const listed = await conversations.list();
		const kept = new Map<number, HeldConversation>();
		for (const each of listed) {
			const task = all.find((queued) => queued.id === each.queued);
			const busy = this.#starting.has(each.queued) || each.handed;
			const pick = task === undefined ? null : pickOf(task);
			const was = this.#heldOn.get(each.id);
			const gone =
				task === undefined ||
				task.stage !== "queued" ||
				(!busy && !canStart(task, all)) ||
				(!busy &&
					pick !== null &&
					(pick.agent !== each.agent ||
						(was !== undefined && was !== JSON.stringify(pick)))) ||
				kept.has(each.queued);
			if (gone && !busy) {
				this.#heldOn.delete(each.id);
				await conversations.drop(each.id);
			} else {
				kept.set(each.queued, each);
			}
		}
		for (const queued of queue.filter((each) => canStart(each, all))) {
			// One being judged is held once that lands on its record, which
			// checks the queue again, so it never waits on the wrong agent.
			if (
				!kept.has(queued.id) &&
				(queued.assignee !== undefined || !this.deps.picker.judging(queued.id))
			) {
				await conversations.hold(queued, pickOf(queued));
			}
		}
		const held = new Map<number, string>();
		const now = await conversations.list();
		for (const id of this.#heldOn.keys()) {
			if (!now.some((each) => each.id === id)) {
				this.#heldOn.delete(id);
			}
		}
		for (const each of now) {
			const at = queue.findIndex((queued) => queued.id === each.queued);
			const queued = queue[at];
			if (queued === undefined) {
				continue;
			}
			if (!this.#heldOn.has(each.id)) {
				this.#heldOn.set(each.id, JSON.stringify(pickOf(queued)));
			}
			held.set(each.queued, each.id);
			const refused = this.#refused.get(queued.id);
			const reason =
				refused?.due === false
					? `could not start: ${refused.why}`
					: paused
						? "paused"
						: "starting";
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

/** A queued task's start the queue was refused, as `QueueRunner` keeps it. */
interface Refused {
	was: string;
	why: string;
	tries: number;
	waited: number;
	due: boolean;
}

/** How many sweeps a start refused `tries` times in a row waits before the next try. */
function retryAfter(tries: number): number {
	return Math.min(RETRY_SWEEPS_MAX, 2 ** (tries - 1));
}

/**
 * Who works a queued task when the picker knew nothing of it, which only a
 * task queued between its reads can be: the next check picks it properly.
 */
const NO_PICK: AgentPick = { agent: "claude" };

/**
 * `queued` as a refused start remembers it, to tell a change from: all but
 * what Auto pick keeps on it, which a start writes itself.
 */
function asWas({ autoPick: _, ...queued }: TaskRecord): string {
	return JSON.stringify(queued);
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
	/** Who works a queued task that names no agent: Auto pick. */
	picker: QueuePicker;
	start: QueueStarter;
	/**
	 * Takes each queued task `stalled` found out of the queue, noting the
	 * blockers it was let go for, as `letGo` does.
	 */
	unqueue: (going: ReadonlyMap<number, readonly number[]>) => Promise<unknown>;
	/** The conversations held for queued tasks; absent, none is held. */
	held?: HeldConversations;
	/**
	 * Whether everything splates starts on its own waits, so no queued task
	 * starts; absent, never paused.
	 */
	paused?: () => boolean;
	log: Logger;
}

/**
 * Whom a queued task that names no agent goes to. Guessing is cheap, for
 * every check; deciding may ask a judge, so it is done as a task starts.
 */
export interface QueuePicker {
	/**
	 * Has the words of each of `queued` the judge has not read judged in the
	 * background, keeping what it says on the task, so guesses find it: one
	 * judgment at a time for a task, its latest words superseding any
	 * waiting. Answers once each is under way, not judged.
	 */
	ahead(queued: readonly TaskRecord[]): Promise<void>;
	/**
	 * Whether queued task `id` is being judged ahead now, so its held
	 * conversation waits for the pick, to be made once its record says it.
	 */
	judging(id: number): boolean;
	/**
	 * Whom each of `queued` would go to now, by id, asking no judge: what was
	 * judged of its words before, else the rule for any task.
	 */
	guess(queued: readonly TaskRecord[]): Promise<Map<number, AgentPick>>;
	/**
	 * Decides whom `queued` starts on, on fresh plan limits, waiting out its
	 * judgment under way and asking the judge only for words it has not
	 * read, and keeps the decision on its record. Never rejects: with no
	 * judge, or one that fails, it takes the rule for any task.
	 */
	decide(queued: TaskRecord): Promise<QueuePicked>;
}

/** What `QueuePicker.decide` decided for a queued task. */
export interface QueuePicked {
	pick: AgentPick;
	/** Logs the decision in conversation `id`, the one that works the task. */
	tell(id: string): Promise<void>;
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
 * queue started it, the commit each task it was blocked by landed as,
 * which it builds on, and to groom it first when it is not yet groomed.
 */
export function queuePrompt(queued: TaskRecord): string {
	// The page reads a lane's words back as an event line (`queueStartOf` in
	// the web package's `queue-start.ts`).
	const lane =
		queued.queuedBy?.by === "lane"
			? `, which lane ${queued.queuedBy.lane} queued`
			: "";
	return [
		`splates server started this task for queued task #${queued.id} from the queue${lane}: nothing it is blocked by is left open.`,
		...(queued.blockersLanded ?? []).map(
			(landed) =>
				`It was blocked by #${landed.id} ${landed.subject}, which landed as ${landed.commit}: \`git show ${landed.commit}\` for what it builds on.`,
		),
		...(queued.groomed
			? []
			: [
					"Groom it first, since nothing has yet, as the splates skill's `references/groom.md` says under Grooming a task you start.",
				]),
		"Work it as the splates skill says, ending in `splates merge` or `splates remove`, or in questions for the user.",
	].join("\n");
}
