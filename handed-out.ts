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
import { HEARTBEAT_IDLE } from "./conversation-state";
import type { Conversation, Conversations } from "./conversations";
import { Everywhere } from "./everywhere";
import {
	HEARTBEAT,
	idleReference,
	reportReference,
	stoppedReference,
} from "./prompts";
import type { WorktreeService } from "./worktree-service";

/**
 * How often every handed-out agent is checked again, for a task that landed
 * or went with no word to its conversation, as from another tree.
 */
export const SWEEP = Duration.mins(5);

/** How long the conversations' changes settle before they are checked. */
const SETTLE = Duration.secs(1);

/**
 * Keeps the conversation that handed tasks out with `arbor add --agent` up
 * to date on the agents it handed them to, so it never waits on one that
 * has gone quiet, a restart included. An agent that is not at work, with its
 * task still under way and not escalated, gets nothing more done unless that
 * one acts, so that one is told `[ARBOR IDLE <task>]`, unless it has heard of
 * the task since the agent last said anything. An agent whose task is gone is archived with that one,
 * off the list. Each is checked as its turn ends, once the conversations'
 * changes settle, as the project opens, and every `SWEEP`.
 *
 * A conversation idle `HEARTBEAT_IDLE` since its last turn, with an agent it
 * handed a task to still at work, is told `[ARBOR HEARTBEAT]`, so it checks
 * on them rather than wait out a long task with no word to the person. Any
 * turn it takes before then puts the next one off again.
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
	/** Each conversation's next heartbeat, by its id. */
	readonly #beats = new Map<string, Resource>();

	private constructor(
		private readonly service: WorktreeService,
		private readonly conversations: Conversations,
		private readonly everywhere: Everywhere,
		private readonly log: Logger,
		private readonly timer: Timer,
		private readonly clock: WallClock,
	) {
		const settled = new Debouncer(timer, SETTLE);
		this.#disposer.defer(() => settled.cancel());
		this.#disposer.defer(
			conversations.events.on("ended", (id) =>
				this.#queue(async () => this.#check(await conversations.find(id))),
			),
		);
		this.#disposer.defer(
			conversations.events.on("changed", () =>
				settled.call(() => this.sweep()),
			),
		);
		this.#disposer.use(timer.setInterval(() => this.sweep(), SWEEP));
		this.#disposer.defer(() => {
			for (const beat of this.#beats.values()) {
				beat.dispose();
			}
		});
	}

	/** Watches `conversations`, checking each handed-out agent at once. */
	static watch({
		service,
		conversations,
		everywhere = Everywhere.onlyHere(service.git.root, conversations),
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
		log: Logger;
		timer?: Timer;
		clock?: WallClock;
	}): HandedOut {
		const watching = new HandedOut(
			service,
			conversations,
			everywhere,
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
			// The agents a conversation here handed tasks to may be in any project.
			const anywhere = await this.#anywhere();
			for (const conversation of all) {
				this.#beat(conversation, anywhere);
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
					`arbor dev could not check on the agents it handed tasks to: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
		return this.#checking;
	}

	async #anywhere(): Promise<Conversation[]> {
		return (await this.everywhere.list()).map((each) => each.conversation);
	}

	/** Keeps `conversation`'s next heartbeat, as `all` stand, on its state and the timer. */
	#beat(conversation: Conversation, all: Conversation[]): void {
		const { id, heartbeat } = conversation.state;
		const at = nextHeartbeat(conversation, all);
		if (at === heartbeat && (at === null || this.#beats.has(id))) {
			return;
		}
		this.#beats.get(id)?.dispose();
		this.#beats.delete(id);
		if (at !== heartbeat) {
			conversation.set({ heartbeat: at });
		}
		if (at === null) {
			return;
		}
		const wait = Duration.ms(Math.max(0, Date.parse(at) - this.clock.now()));
		this.#beats.set(
			id,
			this.timer.setTimeout(
				() =>
					void this.#queue(async () => {
						this.#beats.delete(id);
						// Its agents may have stopped, or it spoke, since.
						const now = nextHeartbeat(conversation, await this.#anywhere());
						if (now === null || Date.parse(now) > this.clock.now()) {
							return;
						}
						conversation.set({ heartbeat: null });
						await conversation.prompt(HEARTBEAT);
					}),
				wait,
			),
		);
	}

	async #check(conversation: Conversation): Promise<void> {
		const { state } = conversation;
		const task = state.task ?? state.lastTask;
		if (state.handedBy === null || state.archived || task === null) {
			return;
		}
		const worktree = await this.service.find(task);
		const found = await this.everywhere.find(state.handedBy);
		const caller = found?.conversation;
		const working = state.status === "running" || state.status === "starting";
		if (worktree.gone) {
			// Its last turn has its report to finish.
			if (!working) {
				await conversation.archive(caller?.id);
			}
			return;
		}
		if (state.status !== "stopped") {
			this.#readBack.delete(state.id);
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
			found === undefined ||
			caller === undefined ||
			caller.state.archived
		) {
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
}

/**
 * When `caller` is next due a heartbeat: `HEARTBEAT_IDLE` after its last turn,
 * while it sits idle with an agent it handed a task to at work; null while
 * none is due.
 */
function nextHeartbeat(
	caller: Conversation,
	all: Conversation[],
): string | null {
	const { state } = caller;
	const last = state.messages.at(-1);
	const since = last?.until ?? last?.at ?? null;
	const working = all.some(
		({ state: each }) =>
			each.handedBy === state.id &&
			!each.archived &&
			each.task !== null &&
			(each.status === "running" || each.status === "starting"),
	);
	if (
		!working ||
		since === null ||
		state.status !== "idle" ||
		state.archived ||
		state.ask !== null ||
		state.checkpoint !== null
	) {
		return null;
	}
	return new Date(Date.parse(since) + HEARTBEAT_IDLE.ms).toISOString();
}

/**
 * Whether `caller` was told of `task` since its agent last said anything:
 * that it stopped, went quiet, or was terminated.
 */
function heard(
	caller: Conversation,
	agent: Conversation,
	task: string,
): boolean {
	const last = agent.state.messages.at(-1);
	const since = last?.until ?? last?.at ?? "";
	const told = [
		reportReference(task),
		idleReference(task),
		stoppedReference(task),
	];
	return caller.state.messages.some(
		(message) =>
			message.role === "user" &&
			(message.at ?? "") >= since &&
			message.parts.some(
				(part) => part.type === "text" && told.includes(part.text.trim()),
			),
	);
}
