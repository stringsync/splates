import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Debouncer, Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { Conversation, Conversations } from "./conversations";
import { idleReference, reportReference, stoppedReference } from "./prompts";
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
		private readonly log: Logger,
		timer: Timer,
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
	}

	/** Watches `conversations`, checking each handed-out agent at once. */
	static watch({
		service,
		conversations,
		log,
		timer = new SystemTimer(),
	}: {
		service: WorktreeService;
		conversations: Conversations;
		log: Logger;
		timer?: Timer;
	}): HandedOut {
		const watching = new HandedOut(service, conversations, log, timer);
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

	async #check(conversation: Conversation): Promise<void> {
		const { state } = conversation;
		const task = state.task ?? state.lastTask;
		if (state.handedBy === null || state.archived || task === null) {
			return;
		}
		const worktree = await this.service.find(task);
		const caller = (await this.conversations.list()).find(
			(each) => each.id === state.handedBy,
		);
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
			caller === undefined ||
			caller.state.archived ||
			heard(caller, conversation, task)
		) {
			return;
		}
		await caller.prompt(idleReference(task));
	}
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
