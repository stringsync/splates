import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { LaneRecord, TaskRecord } from "../board";
import type { AgentPick } from "../models";
import { taskName } from "../queue";

/**
 * How often the running lanes are checked again, for a queued task freed or a task
 * gone with no change seen, as from another tree.
 */
export const LANE_SWEEP = Duration.mins(1);

/** One queued task a running lane starts, as `LaneRunner` hands it to its `start`. */
export interface LaneStart {
	lane: LaneRecord;
	queued: TaskRecord;
	/** The name for its task, one no task out has. */
	task: string;
	/** The agent and model the queued task names. */
	pick: AgentPick;
	/** What its agent is told beyond claiming the task. */
	prompt: string;
	/** The conversation that set the lane running, its task nested under it; null for the person. */
	by: string | null;
}

/**
 * Adds the task for `start`, handed to its agent, which `splates server`
 * starts as for any `splates add --agent`. Throws when the add is refused.
 */
export type LaneStarter = (start: LaneStart) => Promise<void>;

/**
 * Burns a running lane down without an agent keeping it moving: every queued task
 * in it that no task has taken, that names the agent to work it, and that no
 * open queued task blocks, in any lane, its own included, goes out as a task of its
 * own, top first, as many at once as `capacity` allows the lane. As each
 * lands, or its task lets it go, the next check starts what it held back.
 * What blocks what is the links alone: the lane's order is only which goes
 * first when there is no room for all. One whose blocker was removed without
 * merging waits for the person to let that blocker go.
 *
 * Checked as queued or started tasks change, as `splates server` sees them, and
 * every `LANE_SWEEP`. A queued task whose start was refused is not tried again
 * until it changes or the server restarts, so a broken one never loops.
 */
export class LaneRunner implements Resource {
	readonly #disposer = new Disposer();
	/** One check at a time, so no queued task is started twice. */
	#checking = Promise.resolve();
	/** The queued tasks being started now, until their task takes them. */
	readonly #starting = new Set<number>();
	/** Each queued task whose start was refused, as it stood then, by id. */
	readonly #refused = new Map<number, string>();
	/** The queued tasks already said to name no agent, so each is logged once. */
	readonly #unnamed = new Set<number>();

	private constructor(
		private readonly deps: {
			lanes: () => Promise<LaneRecord[]>;
			queued: () => Promise<TaskRecord[]>;
			tasks: () => Promise<string[]>;
			capacity: number;
			start: LaneStarter;
			log: Logger;
		},
		timer: Timer,
	) {
		this.#disposer.use(timer.setInterval(() => this.sweep(), LANE_SWEEP));
	}

	/** Runs the running lanes, checking them at once. */
	static watch({
		timer = new SystemTimer(),
		...deps
	}: {
		/** The lanes on the board, each running one marked so. */
		lanes: () => Promise<LaneRecord[]>;
		/** Every queued task on the list. */
		queued: () => Promise<TaskRecord[]>;
		/** The name of every task out, so a new one takes another. */
		tasks: () => Promise<string[]>;
		/** How many tasks one lane may have out at once. */
		capacity: number;
		start: LaneStarter;
		log: Logger;
		timer?: Timer;
	}): LaneRunner {
		const runner = new LaneRunner(deps, timer);
		runner.sweep();
		return runner;
	}

	/** Starts every queued task the running lanes can start now. */
	sweep(): Promise<void> {
		const next = this.#checking.then(() => this.#check());
		this.#checking = next.catch((error: unknown) =>
			this.deps.log.error(`could not run the lanes: ${String(error)}`),
		);
		return this.#checking;
	}

	async #check(): Promise<void> {
		const records = (await this.deps.lanes()).filter(
			(record) => record.running !== undefined,
		);
		if (records.length === 0) {
			return;
		}
		const all = await this.deps.queued();
		for (const [id, was] of this.#refused) {
			const now = all.find((queued) => queued.id === id);
			if (now === undefined || JSON.stringify(now) !== was) {
				this.#refused.delete(id);
			}
		}
		const names = new Set(await this.deps.tasks());
		const starts: LaneStart[] = [];
		for (const record of records) {
			const { ready, unnamed } = startable(record, all, {
				capacity: this.deps.capacity,
				starting: this.#starting,
				refused: new Set(this.#refused.keys()),
			});
			for (const queued of unnamed) {
				if (!this.#unnamed.has(queued.id)) {
					this.#unnamed.add(queued.id);
					this.deps.log.info(
						`lane ${record.id} holds back queued task ${queued.id}, which names no agent to work it: \`splates task update ${queued.id} --agent <id> --model <m>\``,
					);
				}
			}
			for (const { queued, pick } of ready) {
				const task = taskName(queued.subject, names);
				names.add(task);
				this.#starting.add(queued.id);
				starts.push({
					lane: record,
					queued,
					task,
					pick,
					prompt: lanePrompt(record, queued, all),
					by: record.running?.by ?? null,
				});
			}
		}
		// Each add readies a worktree, an install included, so neither another
		// start nor the next check waits on it: `#starting` holds its queued task.
		for (const start of starts) {
			void (async () => {
				try {
					await this.deps.start(start);
					this.deps.log.info(
						`lane ${start.lane.id} started queued task ${start.queued.id} as ${start.task}`,
					);
				} catch (error) {
					this.#refused.set(start.queued.id, JSON.stringify(start.queued));
					this.deps.log.error(
						`lane ${start.lane.id} could not start queued task ${start.queued.id} as ${start.task}, and leaves it until it changes: ${String(error)}`,
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

/**
 * What running lane `record` can start now: `ready`, top first, as many as
 * it has room for beside the tasks it has out and the queued tasks `starting`, of
 * those no task has taken and no open queued task blocks, nor lost a blocker
 * removed without merging, but for any `refused`;
 * and `unnamed`, those that could go but name no agent to work them.
 */
export function startable(
	record: LaneRecord,
	all: TaskRecord[],
	{
		capacity,
		starting,
		refused,
	}: {
		capacity: number;
		starting: ReadonlySet<number>;
		refused: ReadonlySet<number>;
	},
): {
	ready: { queued: TaskRecord; pick: AgentPick }[];
	unnamed: TaskRecord[];
} {
	const steps = all
		.filter((queued) => queued.lane === record.id)
		.sort((left, right) => left.position - right.position);
	const out = steps.filter(
		(queued) => queued.takenBy !== null || starting.has(queued.id),
	).length;
	const open = new Set(all.map((queued) => queued.id));
	const free = steps.filter(
		(queued) =>
			queued.takenBy === null &&
			!starting.has(queued.id) &&
			!refused.has(queued.id) &&
			!queued.blockedBy.some((id) => open.has(id)) &&
			(queued.blockersLost ?? []).length === 0,
	);
	return {
		ready: free
			.flatMap((queued) =>
				queued.assignee === undefined
					? []
					: [{ queued, pick: queued.assignee }],
			)
			.slice(0, Math.max(0, capacity - out)),
		unnamed: free.filter((queued) => queued.assignee === undefined),
	};
}

/**
 * What a queued task's agent is told beyond claiming its task: that its lane runs
 * on its own, the commit each queued task it was blocked by landed as, which it
 * builds on, and what else in the lane is out beside it, which it may have
 * to rebase onto.
 */
export function lanePrompt(
	record: LaneRecord,
	queued: TaskRecord,
	all: TaskRecord[],
): string {
	const beside = all.filter(
		(each) =>
			each.lane === record.id && each.id !== queued.id && each.takenBy !== null,
	);
	return [
		`splates server started this task for queued task #${queued.id} on its own, as lane ${record.id} (${record.name}) runs: nothing it is blocked by is left open.`,
		...(queued.blockersLanded ?? []).map(
			(landed) =>
				`It was blocked by #${landed.id} ${landed.subject}, which landed as ${landed.commit}: \`git show ${landed.commit}\` for what it builds on.`,
		),
		beside.length === 0
			? "Nothing else in the lane is out beside it."
			: `Out beside it in the lane: ${beside.map((each) => `${each.takenBy} on #${each.id} ${each.subject}`).join("; ")}.`,
		"Work it as the splates skill says, ending in `splates merge`, `splates escalate` or `splates remove`; the lane starts what it held back once it lands.",
	].join("\n");
}
