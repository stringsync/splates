import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { LaneRecord, TodoState } from "../board";
import type { AgentPick } from "../models";

/**
 * How often the running lanes are checked again, for a todo freed or a task
 * gone with no change seen, as from another tree.
 */
export const LANE_SWEEP = Duration.mins(1);

/** The longest task name `taskName` makes, so a long subject stays a name. */
const NAME_LENGTH = 40;

/** One todo a running lane starts, as `LaneRunner` hands it to its `start`. */
export interface LaneStart {
	lane: LaneRecord;
	todo: TodoState;
	/** The name for its task, one no task out has. */
	task: string;
	/** The agent and model the todo names. */
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
 * Burns a running lane down without an agent keeping it moving: every todo
 * in it that no task has taken, that names the agent to work it, and that no
 * open todo blocks, in any lane, its own included, goes out as a task of its
 * own, top first, as many at once as `capacity` allows the lane. As each
 * lands, or its task lets it go, the next check starts what it held back.
 * What blocks what is the links alone: the lane's order is only which goes
 * first when there is no room for all.
 *
 * Checked as the todos or tasks change, as `splates server` sees them, and
 * every `LANE_SWEEP`. A todo whose start was refused is not tried again
 * until it changes or the server restarts, so a broken one never loops.
 */
export class LaneRunner implements Resource {
	readonly #disposer = new Disposer();
	/** One check at a time, so no todo is started twice. */
	#checking = Promise.resolve();
	/** The todos being started now, until their task takes them. */
	readonly #starting = new Set<number>();
	/** Each todo whose start was refused, as it stood then, by id. */
	readonly #refused = new Map<number, string>();
	/** The todos already said to name no agent, so each is logged once. */
	readonly #unnamed = new Set<number>();

	private constructor(
		private readonly deps: {
			lanes: () => Promise<LaneRecord[]>;
			todos: () => Promise<TodoState[]>;
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
		/** Every todo on the list. */
		todos: () => Promise<TodoState[]>;
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

	/** Starts every todo the running lanes can start now. */
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
		const todos = await this.deps.todos();
		for (const [id, was] of this.#refused) {
			const now = todos.find((todo) => todo.id === id);
			if (now === undefined || JSON.stringify(now) !== was) {
				this.#refused.delete(id);
			}
		}
		const names = new Set(await this.deps.tasks());
		const starts: LaneStart[] = [];
		for (const record of records) {
			const { ready, unnamed } = startable(record, todos, {
				capacity: this.deps.capacity,
				starting: this.#starting,
				refused: new Set(this.#refused.keys()),
			});
			for (const todo of unnamed) {
				if (!this.#unnamed.has(todo.id)) {
					this.#unnamed.add(todo.id);
					this.deps.log.info(
						`lane ${record.id} holds back todo ${todo.id}, which names no agent to work it: \`splates todo update ${todo.id} --agent <id> --model <m>\``,
					);
				}
			}
			for (const { todo, pick } of ready) {
				const task = taskName(todo.subject, names);
				names.add(task);
				this.#starting.add(todo.id);
				starts.push({
					lane: record,
					todo,
					task,
					pick,
					prompt: lanePrompt(record, todo, todos),
					by: record.running?.by ?? null,
				});
			}
		}
		// Each add readies a worktree, an install included, so neither another
		// start nor the next check waits on it: `#starting` holds its todo.
		for (const start of starts) {
			void (async () => {
				try {
					await this.deps.start(start);
					this.deps.log.info(
						`lane ${start.lane.id} started todo ${start.todo.id} as ${start.task}`,
					);
				} catch (error) {
					this.#refused.set(start.todo.id, JSON.stringify(start.todo));
					this.deps.log.error(
						`lane ${start.lane.id} could not start todo ${start.todo.id} as ${start.task}, and leaves it until it changes: ${String(error)}`,
					);
				} finally {
					this.#starting.delete(start.todo.id);
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
 * it has room for beside the tasks it has out and the todos `starting`, of
 * those no task has taken and no open todo blocks, but for any `refused`;
 * and `unnamed`, those that could go but name no agent to work them.
 */
export function startable(
	record: LaneRecord,
	todos: TodoState[],
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
	ready: { todo: TodoState; pick: AgentPick }[];
	unnamed: TodoState[];
} {
	const steps = todos
		.filter((todo) => todo.lane === record.id)
		.sort((left, right) => left.position - right.position);
	const out = steps.filter(
		(todo) => todo.takenBy !== null || starting.has(todo.id),
	).length;
	const open = new Set(todos.map((todo) => todo.id));
	const free = steps.filter(
		(todo) =>
			todo.takenBy === null &&
			!starting.has(todo.id) &&
			!refused.has(todo.id) &&
			!todo.blockedBy.some((id) => open.has(id)),
	);
	return {
		ready: free
			.flatMap((todo) =>
				todo.assignee === undefined ? [] : [{ todo, pick: todo.assignee }],
			)
			.slice(0, Math.max(0, capacity - out)),
		unnamed: free.filter((todo) => todo.assignee === undefined),
	};
}

/**
 * A task name for a todo called `subject`: its words, lowercased and
 * dashed, cut at a word to `NAME_LENGTH`, and numbered past any in `taken`.
 */
export function taskName(subject: string, taken: ReadonlySet<string>): string {
	const words = subject
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	let base = "";
	for (const word of words) {
		const longer = base === "" ? word : `${base}-${word}`;
		if (longer.length > NAME_LENGTH && base !== "") {
			break;
		}
		base = longer.slice(0, NAME_LENGTH);
	}
	base ||= "todo";
	let name = base;
	for (let count = 2; taken.has(name); count++) {
		name = `${base}-${count}`;
	}
	return name;
}

/**
 * What a todo's agent is told beyond claiming its task: that its lane runs
 * on its own, and what else in the lane is out beside it, which it may
 * have to rebase onto.
 */
export function lanePrompt(
	record: LaneRecord,
	todo: TodoState,
	todos: TodoState[],
): string {
	const beside = todos.filter(
		(each) =>
			each.lane === record.id && each.id !== todo.id && each.takenBy !== null,
	);
	return [
		`splates server started this task for todo #${todo.id} on its own, as lane ${record.id} (${record.name}) runs: nothing it is blocked by is left open.`,
		beside.length === 0
			? "Nothing else in the lane is out beside it."
			: `Out beside it in the lane: ${beside.map((each) => `${each.takenBy} on #${each.id} ${each.subject}`).join("; ")}.`,
		"Work it as the splates skill says, ending in `splates merge`, `splates escalate` or `splates remove`; the lane starts what it held back once it lands.",
	].join("\n");
}
