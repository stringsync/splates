import type { Logger } from "webappwiz/log";
import type { Task } from "../board";
import {
	type Conversation,
	type Conversations,
	GROOMER_ROLE,
	SERVER_TOLD,
} from "../conversations";
import { type AgentPick, effortSettings } from "../models";
import { groomReference } from "../plans";

/**
 * The project's groomer, one at a time: woken by a task added to the
 * backlog, or as `splates server` starts, it works down the backlog in
 * order, claiming each task before telling its one persistent conversation
 * `[SPLATES GROOM #N]`, and waits for that turn to end before the next. The
 * backlog as it stands decides what it grooms, never the event that woke
 * it, so a wake missed or doubled changes nothing.
 *
 * A task someone takes meanwhile, or one already groomed, is left be, as
 * the claim (`Task.groom`) refuses it; one the groomer had its turn on and
 * left in the backlog keeps its claim, so it is not groomed again on every
 * wake, until a groomer of another conversation takes over.
 */
export class Groomer {
	/** The drain running now, which a wake meanwhile asks to go round again. */
	#draining: Promise<void> | null = null;
	#again = false;
	/** What the groomer runs as, the latest a wake gave; null while it is off. */
	#pick: AgentPick | null = null;

	constructor(private readonly deps: GroomerDeps) {}

	/**
	 * Grooms the backlog as `pick`, or, for null, as when the groomer is off
	 * or paused, retires its conversation once it is idle. Settles once the
	 * backlog holds nothing more to claim.
	 */
	wake(pick: AgentPick | null): Promise<void> {
		this.#pick = pick;
		if (this.#draining !== null) {
			this.#again = true;
			return this.#draining;
		}
		this.#draining = (async () => {
			try {
				do {
					this.#again = false;
					const now = this.#pick;
					await (now === null ? this.#retire() : this.#drain(now));
				} while (this.#again);
			} catch (error) {
				this.deps.log.error(`the groomer stopped: ${String(error)}`);
			} finally {
				this.#draining = null;
			}
		})();
		return this.#draining;
	}

	async #drain(pick: AgentPick): Promise<void> {
		// Turned off meanwhile, it stops after the turn it was on.
		while (this.#pick !== null) {
			const backlog = (await this.deps.tasks()).filter(
				(task) => task.state.stage === "backlog" && task.takenBy === null,
			);
			if (backlog.length === 0) {
				return;
			}
			const conversation = await this.#conversation(pick);
			const next = await claimFirst(backlog, conversation.id);
			if (next === null) {
				return;
			}
			await conversation.prompt(groomReference(next.id), [], undefined, {
				told: SERVER_TOLD,
			});
			await this.#settled(conversation);
			this.deps.log.info(`the groomer had its turn on task ${next.id}`);
			if (conversation.state.status === "failed") {
				this.deps.log.error(
					`the groomer's agent failed, so the backlog waits for its next wake: ${conversation.state.error ?? "no reason given"}`,
				);
				return;
			}
		}
	}

	/** The groomer's conversation, started in the main tree when there is none. */
	async #conversation(pick: AgentPick): Promise<Conversation> {
		const { conversations, root } = this.deps;
		const kept = await conversations.persistent(GROOMER_ROLE);
		if (kept !== null) {
			return kept;
		}
		const offered = (await conversations.settings())[pick.agent] ?? [];
		return conversations.start(pick.agent, {
			task: null,
			cwd: root,
			model: pick.model,
			settings: effortSettings(pick.effort, offered),
			assigned: true,
			capped: true,
			persistent: GROOMER_ROLE,
		});
	}

	/** Archives the groomer's conversation, once no turn of its runs. */
	async #retire(): Promise<void> {
		const kept = await this.deps.conversations.persistent(GROOMER_ROLE);
		if (kept === null || kept.state.archived) {
			return;
		}
		await this.#settled(kept);
		await kept.archive();
	}

	/** Settles once `conversation` runs no turn and has nothing queued to say. */
	#settled(conversation: Conversation): Promise<void> {
		const { events } = this.deps.conversations;
		const done = (): boolean =>
			!BUSY.has(conversation.state.status) &&
			!conversation.state.messages.some((message) => message.queued);
		if (done()) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			const off = events.on("changed", (id) => {
				if (id === conversation.id && done()) {
					off();
					resolve();
				}
			});
		});
	}
}

/** What a `Groomer` works with. */
export interface GroomerDeps {
	/** Every task on the list, in its order, the top first. */
	tasks: () => Promise<Task[]>;
	/** The project's conversations, where its groomer is kept. */
	conversations: Conversations;
	/** The main tree, where the groomer runs, with no worktree of its own. */
	root: string;
	log: Logger;
}

/** What a conversation is at while a turn of its is under way. */
const BUSY = new Set(["starting", "running"]);

/** The first of `backlog` claimed for `by`, or null when none would be. */
async function claimFirst(
	backlog: readonly Task[],
	by: string,
): Promise<Task | null> {
	for (const task of backlog) {
		if (await task.groom(by)) {
			return task;
		}
	}
	return null;
}
