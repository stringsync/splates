import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	Debouncer,
	Duration,
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type { LaneRecord, TaskRecord } from "../board";
import {
	type LaneTaskChange,
	laneChanges,
	laneTasks,
	type SeenLaneTasks,
} from "../board";
import type { Conversation, Conversations, Message } from "../conversations";
import { lanesOf, SERVER_TOLD, startedLanes } from "../conversations";
import {
	CARRY_ON,
	directive,
	idleReference,
	LANES_DONE,
	reportReference,
	type Stretch,
	stretches,
	taskAddedReference,
	taskDoneReference,
	taskOpenReference,
	UNTRIAGED,
} from "../plans";
import { Everywhere } from "../projects";
import type { WorktreeService } from "./worktree-service";

/**
 * How often every handed-out agent is checked again, for a task that landed
 * or went with no word to its conversation, as from another tree.
 */
export const SWEEP = Duration.mins(5);

/** How long the conversations' changes settle before they are checked. */
const SETTLE = Duration.secs(1);

/**
 * Keeps the conversation that handed tasks out, a lane's orchestrator with
 * `splates add --agent`, up to date on the agents it handed them to, so it
 * never waits on one that has gone quiet, a restart included. An agent that
 * is not at work, with its task still under way and not escalated, gets
 * nothing more done unless that one acts, so that one is told
 * `[SPLATES IDLE <task>]`, unless it has heard of the task since the agent
 * last said anything, or the person took the agent in hand. Each is checked
 * as its turn ends, once the conversations' changes settle, as the project
 * opens, and every `SWEEP`.
 *
 * The agent of a task a running lane started answers to the lane rather
 * than its orchestrator: quiet, it is told `CARRY_ON` by `splates server`
 * itself, once, and quiet again with nothing said to it since, its queued task is
 * marked stuck and only then is its orchestrator, if any, told
 * `[SPLATES IDLE <task>]`. At work again, it is stuck no longer.
 *
 * A lane's orchestrator is told `[SPLATES TASK DONE #N]` as a queued task in a lane
 * it works leaves the list, and `[SPLATES TASK OPEN #N]` as one comes back
 * open, however that came about, so the queued tasks drive the lane rather than its
 * agents reporting back. A running lane starts its queued tasks itself, so its
 * orchestrator hears neither, only `[SPLATES TASK ADDED #N]` as a queued task comes
 * into it, to plan it in. What changed while `splates server` was down is
 * told once it is back.
 *
 * A lane's orchestrator whose lanes are all done, however their last queued tasks
 * landed, that sits idle on a Working or Waiting report, as though they were
 * not, is told `[SPLATES LANES DONE]`, once since it last started lanes, so it
 * ends on its Finished report.
 *
 * A lane's orchestrator whose turn ends on its Finished report is archived,
 * with the agents it started, as the page's Archive lane
 * button does, unless one of them still holds a task, which leaves the lane
 * to the person. Only as the turn ends, so a lane they bring back stays.
 */
export class HandedOut implements Resource {
	/**
	 * The agents stopped as a run before this one ended, until they next
	 * move: stopped in this run, it was by a shutdown or by the person, who
	 * is told of it otherwise.
	 */
	readonly #readBack = new Set<string>();
	#opened = false;
	readonly #disposer = new Disposer();
	/** One check at a time, so no agent is told of twice. */
	#checking = Promise.resolve();

	private constructor(
		private readonly service: WorktreeService,
		private readonly conversations: Conversations,
		private readonly everywhere: Everywhere,
		private readonly lanes: () => Promise<LaneRecord[]>,
		private readonly queued: () => Promise<TaskRecord[]>,
		private readonly seen: SeenLaneTasks,
		private readonly stuck: StuckTasks,
		private readonly log: Logger,
		readonly timer: Timer,
		private readonly clock: WallClock,
	) {
		const settled = new Debouncer(timer, SETTLE);
		this.#disposer.defer(() => settled.cancel());
		this.#disposer.defer(
			conversations.events.on("ended", (id) =>
				this.#queue(async () => {
					const conversation = await conversations.find(id);
					await this.#check(conversation);
					await this.#archiveFinished(conversation);
				}),
			),
		);
		this.#disposer.defer(
			conversations.events.on("changed", () =>
				settled.call(() => this.sweep()),
			),
		);
		this.#disposer.use(timer.setInterval(() => this.sweep(), SWEEP));
	}

	/** Watches `conversations`, checking each handed-out agent at once. */
	static watch({
		service,
		conversations,
		everywhere = Everywhere.onlyHere(service.git.root, conversations),
		lanes,
		queued,
		seen,
		stuck,
		log,
		timer = new SystemTimer(),
		clock = new SystemWallClock(),
	}: {
		service: WorktreeService;
		conversations: Conversations;
		/**
		 * Every project's conversations, where the one that handed out a task
		 * here may be; this project's alone by default.
		 */
		everywhere?: Everywhere;
		/** The lanes on the board, a lane gone from it once it is done. */
		lanes: () => Promise<LaneRecord[]>;
		/** Every queued task on the list. */
		queued: () => Promise<TaskRecord[]>;
		/** The lane queued tasks as last seen, kept past a restart. */
		seen: SeenLaneTasks;
		/** Where a queued task is marked stuck. */
		stuck: StuckTasks;
		log: Logger;
		timer?: Timer;
		clock?: WallClock;
	}): HandedOut {
		const watching = new HandedOut(
			service,
			conversations,
			everywhere,
			lanes,
			queued,
			seen,
			stuck,
			log,
			timer,
			clock,
		);
		watching.sweep();
		return watching;
	}

	/** Checks every handed-out agent again. */
	sweep(): Promise<void> {
		return this.#queue(async () => {
			const all = await this.conversations.list();
			if (!this.#opened) {
				this.#opened = true;
				for (const each of all) {
					if (each.state.status === "stopped") {
						this.#readBack.add(each.id);
					}
				}
			}
			for (const conversation of all) {
				await this.#check(conversation);
			}
			const lanes = await this.lanes();
			// Before the lanes done, so one told of its last queued task ends there.
			await this.#tell(all, lanes);
			for (const conversation of all) {
				await this.#finish(conversation, lanes);
			}
		});
	}

	dispose(): void {
		this.#disposer.dispose();
	}

	#queue(work: () => Promise<void>): Promise<void> {
		this.#checking = this.#checking
			.then(work)
			.catch((error: unknown) =>
				this.log.error(
					`splates server could not check on the agents it handed tasks to: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
		return this.#checking;
	}

	async #anywhere(): Promise<Conversation[]> {
		return (await this.everywhere.list()).map((each) => each.conversation);
	}

	/**
	 * Tells each orchestrator in `all` what became of the queued tasks in the lanes
	 * it works since they were last seen.
	 */
	async #tell(all: Conversation[], lanes: LaneRecord[]): Promise<void> {
		const stored = await this.queued();
		const now = laneTasks(stored, lanes);
		const before = await this.seen.read();
		if (before !== null) {
			for (const change of laneChanges(before, now, stored)) {
				for (const conversation of all) {
					if (this.#works(conversation, change)) {
						await conversation.prompt(
							change.change === "added"
								? taskAddedReference(change.number)
								: change.change === "done"
									? taskDoneReference(change.number)
									: taskOpenReference(change.number),
						);
					}
				}
			}
		}
		if (JSON.stringify(before) !== JSON.stringify(now)) {
			await this.seen.write(now);
		}
	}

	/** Whether `conversation` orchestrates the lane `change` is in, and is still at it. */
	#works(conversation: Conversation, change: LaneTaskChange): boolean {
		const { state } = conversation;
		return (
			!state.archived &&
			// Stopped by the person, it is theirs.
			(state.status !== "stopped" || this.#readBack.has(state.id)) &&
			(lanesOf(state).includes(String(change.lane.id)) ||
				startedLanes(state).includes(change.lane.name)) &&
			!finished(state)
		);
	}

	/**
	 * Tells `conversation`, when it last said its lanes are under way and
	 * none of them is left in `lanes`, that they are done, unless it was told
	 * so since it last started any.
	 */
	async #finish(
		conversation: Conversation,
		lanes: LaneRecord[],
	): Promise<void> {
		const { state } = conversation;
		if (
			state.archived ||
			// Stopped by a restart, it is as idle; by the person, theirs.
			!(
				state.status === "idle" ||
				(state.status === "stopped" && this.#readBack.has(state.id))
			) ||
			state.ask !== null ||
			state.checkpoint !== null ||
			!onLanes(state.messages.at(-1))
		) {
			return;
		}
		const sent = lanesOf(state).filter((lane) => lane !== UNTRIAGED);
		const named = startedLanes(state);
		if (
			(sent.length === 0 && named.length === 0) ||
			lanes.some(
				(lane) => sent.includes(String(lane.id)) || named.includes(lane.name),
			)
		) {
			return;
		}
		const since = state.messages.slice(
			state.messages.findLastIndex((message) => startsIn(message)) + 1,
		);
		if (
			since.some(
				(message) =>
					message.role === "user" &&
					message.parts.some(
						(part) =>
							part.type === "text" && directive(part.text) === LANES_DONE,
					),
			)
		) {
			return;
		}
		await conversation.prompt(LANES_DONE);
	}

	/**
	 * Archives `conversation`, with the agents it started or handed tasks to,
	 * when its last turn ended on its Finished report and none of them holds
	 * a task.
	 */
	async #archiveFinished(conversation: Conversation): Promise<void> {
		const { state } = conversation;
		if (
			state.archived ||
			state.status !== "idle" ||
			state.ask !== null ||
			!finishes(state.messages.at(-1))
		) {
			return;
		}
		// The agents it started may be in other projects.
		const theirs = (await this.#anywhere()).filter(
			({ state: each }) => each.startedBy === state.id && !each.archived,
		);
		if (theirs.some((each) => each.state.task !== null)) {
			return;
		}
		await Promise.all(theirs.map((each) => each.archive(state.id)));
		await conversation.archive();
	}

	async #check(conversation: Conversation): Promise<void> {
		const { state } = conversation;
		const task = state.task ?? state.lastTask;
		const by = state.startedBy;
		if (state.archived || task === null) {
			return;
		}
		const record = await this.#laneTask(task);
		if (by === null && record === null) {
			return;
		}
		const worktree = await this.service.find(task);
		const found = by === null ? undefined : await this.everywhere.find(by);
		const caller = found?.conversation;
		const working = state.status === "running" || state.status === "starting";
		if (worktree.gone) {
			// Its last turn has its report to finish; the person archives it.
			return;
		}
		if (state.status !== "stopped") {
			this.#readBack.delete(state.id);
		}
		if (working && record?.stuck !== undefined) {
			await this.stuck.markStuck(record.id, null);
		}
		const quiet =
			state.status === "failed" ||
			// Stopped by a checkpoint, it waits on the resume instead; one
			// that failed to come back is quiet like any other.
			(state.checkpoint === null &&
				(this.#readBack.has(state.id) ||
					// One that has opened idle has yet to be told anything.
					(state.status === "idle" && state.messages.length > 0)));
		if (
			!quiet ||
			worktree.state?.status === "escalated" ||
			// One the person took in hand waits on them, not on its orchestrator.
			inHand(state)
		) {
			return;
		}
		if (record !== null) {
			if (!nudged(state, this.#readBack.has(state.id))) {
				await conversation.prompt(CARRY_ON, [], undefined, {
					told: SERVER_TOLD,
				});
				return;
			}
			if (record.stuck === undefined) {
				await this.stuck.markStuck(
					record.id,
					new Date(this.clock.now()).toISOString(),
				);
			}
		}
		if (found === undefined || caller === undefined || caller.state.archived) {
			return;
		}
		const named = await this.everywhere.taskNamed(
			task,
			this.service.git.root,
			found.root,
		);
		if (heard(caller, conversation, named)) {
			return;
		}
		await caller.prompt(idleReference(named));
	}

	/** The queued task `task` holds in a running lane, or null for none. */
	async #laneTask(task: string): Promise<TaskRecord | null> {
		const record = (await this.queued()).find((each) => each.takenBy === task);
		if (record === undefined || record.lane === null) {
			return null;
		}
		const lane = (await this.lanes()).find((each) => each.id === record.lane);
		return lane?.running === undefined ? null : record;
	}
}

/** The queued tasks, as far as marking one stuck goes. */
export interface StuckTasks {
	/** Marks queued task `id` stuck since `at`, or not stuck for null. */
	markStuck(id: number, at: string | null): Promise<void>;
}

/**
 * Whether the agent of a running lane's task was told `CARRY_ON` and has
 * been quiet since with nothing more said to it: stuck. One a restart
 * stopped, `stopped` here, did not stop of itself, so it is told again.
 */
function nudged(state: Conversation["state"], stopped: boolean): boolean {
	const said = state.messages.findLast((message) => message.role === "user");
	return (
		!stopped &&
		said?.told === SERVER_TOLD &&
		said.parts.some(
			(part) => part.type === "text" && part.text.trim() === CARRY_ON,
		)
	);
}

/** Whether the last report `state`'s agent made on its lanes is its Finished one. */
function finished(state: Conversation["state"]): boolean {
	const last = state.messages
		.flatMap(stretchesOf)
		.findLast((each) => each.type === "report" && "lanes" in each.report);
	return last?.type === "report" && last.report.ending === "finished";
}

/** The stretches of `message`, the agent's; none for the person's. */
function stretchesOf(message: Message): Stretch[] {
	return message.role !== "agent"
		? []
		: message.parts.flatMap((part) =>
				part.type === "text" ? stretches(part.text) : [],
			);
}

/** Whether `message`, the agent's, holds a Started card. */
function startsIn(message: Message): boolean {
	return stretchesOf(message).some((each) => each.type === "start");
}

/** Whether `message` is the agent's and its last report on lanes is its Finished one. */
function finishes(message: Message | undefined): boolean {
	const last = (message === undefined ? [] : stretchesOf(message)).findLast(
		(each) => each.type === "report" && "lanes" in each.report,
	);
	return last?.type === "report" && last.report.ending === "finished";
}

/**
 * Whether `message` is the agent's and its last report on lanes says they
 * are under way: Working, or Waiting on the person.
 */
function onLanes(message: Message | undefined): boolean {
	const last = (message === undefined ? [] : stretchesOf(message)).findLast(
		(each) => each.type === "report" && "lanes" in each.report,
	);
	return (
		last?.type === "report" &&
		(last.report.ending === "working" || last.report.ending === "waiting")
	);
}

/**
 * Whether `caller` was told of `task` since its agent last said anything:
 * that it stopped or went quiet.
 */
function heard(
	caller: Conversation,
	agent: Conversation,
	task: string,
): boolean {
	const last = agent.state.messages.at(-1);
	const since = last?.until ?? last?.at ?? "";
	const told = [reportReference(task), idleReference(task)];
	return caller.state.messages.some(
		(message) =>
			message.role === "user" &&
			(message.at ?? "") >= since &&
			message.parts.some(
				(part) => part.type === "text" && told.includes(part.text.trim()),
			),
	);
}

/**
 * Whether the person took a conversation in hand since it was handed its
 * task: the last word said to it was theirs, not `splates tell`'s, or they
 * stopped its last turn. Its orchestrator then leaves it to them.
 */
function inHand(state: Conversation["state"]): boolean {
	const said = state.messages.findLast((message) => message.role === "user");
	return (
		(said !== undefined && said.told === undefined) ||
		state.messages.at(-1)?.stopped !== undefined
	);
}
