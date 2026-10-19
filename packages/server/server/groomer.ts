import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Task } from "../board";
import {
	type Conversation,
	type Conversations,
	GROOMER_ROLE,
	SERVER_TOLD,
} from "../conversations";
import { type AgentPick, effortSettings } from "../models";
import { groomReference, need } from "../plans";

/**
 * The project's groomer, one at a time: woken by a task added to the
 * backlog, or as `splates server` starts, it works down the backlog in
 * order, claiming each task before telling the run's conversation
 * `[SPLATES GROOM #N]`, and waits for that turn to end before the next. The
 * backlog as it stands decides what it grooms, never the event that woke
 * it, so a wake missed or doubled changes nothing.
 *
 * Each run, from a wake to an empty backlog, starts a conversation of its
 * own, so its agent starts from a fresh context, and archives it resting as
 * the run ends, which stops its agent; the newest holds the groomer's row
 * on the page until the next run. One that ends asking you something stays
 * open until a turn after your reply ends with nothing more asked.
 *
 * A task someone takes meanwhile, or one already groomed, is left be, as
 * the claim (`Task.groom`) refuses it; one a groomer had its turn on and
 * left in the backlog keeps its claim, so no later run grooms it again.
 */
export class Groomer implements Resource {
	/** The drain running now, which a wake meanwhile asks to go round again. */
	#draining: Promise<void> | null = null;
	#again = false;
	/** What the groomer runs as, the latest a wake gave; null while it is off. */
	#pick: AgentPick | null = null;
	/** The run's conversation, while a run is on. */
	#running: Conversation | null = null;
	/** The groomer's conversations outside a run that started a turn since, by id. */
	readonly #turning = new Set<string>();
	readonly #off: () => void;

	constructor(private readonly deps: GroomerDeps) {
		this.#off = deps.conversations.events.on("changed", (id) => {
			this.#restAfterTurn(id).catch((error: unknown) =>
				deps.log.error(
					`the groomer could not put conversation ${id} away: ${String(error)}`,
				),
			);
		});
	}

	dispose(): void {
		this.#off();
	}

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
		let conversation: Conversation | null = null;
		try {
			// Turned off meanwhile, it stops after the turn it was on.
			while (this.#pick !== null) {
				const backlog = (await this.deps.tasks()).filter(
					(task) =>
						task.state.stage === "backlog" &&
						task.takenBy === null &&
						task.state.grooming === undefined,
				);
				if (backlog.length === 0) {
					return;
				}
				if (conversation === null) {
					conversation = await this.#start(pick);
					this.#running = conversation;
				}
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
		} finally {
			if (conversation !== null) {
				await this.#settled(conversation);
				this.#running = null;
				await this.#rest(conversation);
			}
		}
	}

	/**
	 * A new conversation for a run, in the main tree, once each the groomer
	 * still has open with nothing asked of you, as one from before runs had
	 * their own, is put away.
	 */
	async #start(pick: AgentPick): Promise<Conversation> {
		const { conversations, root } = this.deps;
		for (const open of await this.#open()) {
			await this.#settled(open);
			await this.#rest(open);
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

	/**
	 * Archives each conversation the groomer has open, and its newest, once
	 * no turn of theirs runs, none resting, so the page drops its row.
	 */
	async #retire(): Promise<void> {
		const newest = await this.deps.conversations.persistent(GROOMER_ROLE);
		const open = await this.#open();
		const all =
			newest === null || open.includes(newest) ? open : [...open, newest];
		for (const each of all) {
			await this.#settled(each);
			await each.archive();
		}
	}

	/** The groomer's conversations not archived, newest first. */
	async #open(): Promise<Conversation[]> {
		return (await this.deps.conversations.list()).filter(
			({ state }) => state.persistent === GROOMER_ROLE && !state.archived,
		);
	}

	/** Archives `conversation` resting, unless it waits on you. */
	async #rest(conversation: Conversation): Promise<void> {
		if (need(null, conversation.state).kind !== "waiting") {
			await conversation.archive(undefined, { rest: true });
		}
	}

	/**
	 * Puts a groomer's conversation outside a run away once a turn of its
	 * ends with nothing asked of you, as after your reply to its questions.
	 */
	async #restAfterTurn(id: string): Promise<void> {
		const conversation = await this.deps.conversations
			.find(id)
			.catch(() => null);
		if (
			conversation === null ||
			conversation === this.#running ||
			conversation.state.persistent !== GROOMER_ROLE ||
			conversation.state.archived
		) {
			this.#turning.delete(id);
			return;
		}
		if (conversation.state.status === "running") {
			this.#turning.add(id);
			return;
		}
		if (
			conversation.state.status !== "starting" &&
			this.#turning.has(id) &&
			!conversation.state.messages.some((message) => message.queued)
		) {
			this.#turning.delete(id);
			await this.#rest(conversation);
		}
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
