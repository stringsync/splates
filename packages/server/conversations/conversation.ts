// scry-ignore-file compact-files: the conversation lifecycle coordinates its delegated turns, files, connection, and log as one public object.
import type * as acp from "@agentclientprotocol/sdk";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration } from "webappwiz/time";
import type { Agent, AgentProcess, ProcessHandle } from "../agents";
import { AgentConnection, fold, heard } from "../agents";
import { Artifacts, applyArtifact } from "../artifacts";
import { fail } from "../exit";
import { finishObservation } from "../models";
import { RECONNECT, taskReference } from "../plans";
import type { Grant, WorkerMachine } from "../workers";
import { answerWords } from "./answered";
import { put } from "./archive";
import { ConversationBackground } from "./background";
import { choose } from "./choice";
import { ConversationFiles } from "./files";
import type {
	ConversationDeps,
	ConversationEvents,
	ConversationHost,
	Hold,
	Placement,
} from "./host";
import { ConversationLog, type Live } from "./log";
import { sent } from "./messages";
import {
	type Answer,
	type Ask,
	type Attached,
	blank,
	type ConversationState,
	callerAfter,
	type Device,
	IDLE_STOP,
	type Limit,
	type QueueSpot,
	runOn,
	type Upload,
} from "./state";
import { ConversationTurns, type PromptOptions } from "./turns";

/**
 * How many times in a row a conversation reconnects by itself before it
 * leaves the Reconnect button to the person.
 */
const RECONNECTS = 3;

/** How long it waits to reconnect, times the tries so far. */
const RECONNECT_WAIT = Duration.secs(2);

/**
 * One conversation with one agent. Live, it holds the agent's process; read
 * back from its log, it is what was said, and resumes on the next prompt.
 */
export class Conversation
	implements Eventful<ConversationEvents>, Resource, ConversationHost
{
	private readonly dispatcher = new Dispatcher<ConversationEvents>();
	readonly events = this.dispatcher.events;

	private readonly files: ConversationFiles;
	/** The files its agent kept as its outputs, read and changed here. */
	readonly artifacts: Artifacts;
	private readonly connection: AgentConnection;
	private readonly turns: ConversationTurns;
	private readonly background: ConversationBackground;
	/** Under way while the agent starts or comes back, for a prompt to wait on. */
	opening: Promise<void> | null = null;
	/** Stops the agent once it has sat idle `IDLE_STOP`; null while it works. */
	private resting: Resource | null = null;
	/** Says `[SPLATES RECONNECT]` once its wait is up; null while none is due. */
	private reconnecting: Resource | null = null;
	/** How many times in a row it has reconnected by itself. */
	private reconnects = 0;
	/** Let go of its process for a restart: nothing here ends it now. */
	private detached = false;
	/** The slot its agent holds on a worker; null while it has none. */
	private grant: Grant | null = null;
	/** Takes its agent out of the queue for a slot; null while it waits in none. */
	private placing: AbortController | null = null;
	/** The worker other than this machine's it was last placed on; null for none. */
	private placed: WorkerMachine | null = null;
	/**
	 * What its next prompt is to follow, for an agent taken off a worker
	 * while idle: its new session knows nothing of the task. Null for none.
	 */
	private carry: string | null = null;
	/**
	 * The question its agent was asking when a drain freed its slot, kept
	 * on the page for the person to answer (`free`); null for none.
	 */
	private kept: Ask | null = null;
	/** Under way while it saves its task to free its slot. */
	private freeing = false;
	/** Stops hearing of workers that start draining; null with no slots. */
	private readonly unlistenDrain: (() => void) | null;

	private constructor(
		readonly state: ConversationState,
		readonly log: ConversationLog,
		private readonly deps: ConversationDeps,
		/** What to run to resume it; null when its agent is no longer known. */
		private ran: Agent | null,
		/** Where it runs; null for a log too old to say. */
		private dir: string | null,
		{
			session = null,
			loading = false,
			picks = {},
			model = null,
			sessionCwd = dir,
		}: From = {},
	) {
		this.files = new ConversationFiles(log.path, deps.fs, {
			projects: deps.projects,
			home: deps.root,
		});
		this.artifacts = new Artifacts(log.path, {
			fs: deps.fs,
			ids: deps.ids,
			limits: deps.artifacts,
			room: deps.room,
			now: () => this.now(),
			held: () => this.state.artifacts,
			record: async (change) => {
				this.log.write({ kind: "artifact", change });
				await this.log.flush();
				applyArtifact(this.state.artifacts, change);
				this.changed();
			},
		});
		this.connection = new AgentConnection(this, deps, {
			session,
			loading,
			picks,
			model,
			sessionCwd,
		});
		this.turns = new ConversationTurns(this, deps, this.connection, this.files);
		this.background = new ConversationBackground(this, deps, this.connection);
		this.unlistenDrain =
			deps.slots?.events.on("drain", (worker) => {
				if (this.grant?.worker === worker) {
					void (this.grant.replaces() ? this.moveOff() : this.free());
				}
			}) ?? null;
	}

	/**
	 * A conversation as its log at `path` left it: stopped, whatever it was
	 * doing, unless its agent still runs on a worker, which the launcher
	 * takes back, and the conversation carries on where the log leaves off.
	 */
	static async read(
		path: string,
		agents: Agent[],
		deps: ConversationDeps,
	): Promise<Conversation | null> {
		const log = new ConversationLog(path, deps.fs, deps.timer);
		const replayed = await log.replay();
		if (replayed === null) {
			return null;
		}
		const { state, session, cwd, picks, model, sessionCwd } = replayed;
		const agent = agents.find((each) => each.id === state.agent) ?? null;
		let taken: { process: AgentProcess; live: Live; hold: Hold | null } | null =
			null;
		if (replayed.live !== null) {
			const { live } = replayed;
			if (agent !== null) {
				taken = Conversation.takeBack(state, live, deps);
			}
			if (taken === null) {
				await log.stopped(replayed);
			}
		}
		const conversation = new Conversation(state, log, deps, agent, cwd, {
			session,
			picks,
			model,
			sessionCwd,
		});
		// A turn cut short as it was read back carries on by itself, as one
		// whose process is lost while the server runs does.
		if (replayed.cut === true) {
			conversation.reconnect();
		}
		if (taken !== null && agent !== null) {
			conversation.grant = taken.hold;
			conversation.placed = taken.hold?.machine ?? null;
			conversation.connection.reattach(agent, taken.process, taken.live);
		}
		return conversation;
	}

	/**
	 * The agent `live` names, taken back on the worker it runs on, holding
	 * its slot there; null when nothing here runs it any more, stopped as
	 * any dead process is.
	 */
	private static takeBack(
		state: ConversationState,
		live: Live,
		deps: ConversationDeps,
	): { process: AgentProcess; live: Live; hold: Hold | null } | null {
		let hold: Hold | null = null;
		try {
			hold =
				deps.slots?.hold(
					{
						id: state.id,
						task: state.task,
						agent: state.agent,
						uncapped: !spawned(state),
					},
					live.handle.worker,
				) ?? null;
			const process = (hold ?? deps.launcher).resume(live.handle, live.held);
			return { process, live, hold };
		} catch {
			hold?.dispose();
			return null;
		}
	}

	/** Starts `agent` in `cwd` and opens a session with it. */
	static async start(
		{
			settings = {},
			model,
			picking,
			...opening
		}: Opening & {
			/** Values to set, by setting id, once the session offers them. */
			settings?: Record<string, string>;
			/**
			 * The model to pick, by its value or name in the session's model
			 * setting, over what `settings` says. An unavailable choice fails.
			 */
			model?: string;
			/**
			 * What Auto picks, once it has, to open on in place of `agent`,
			 * `settings` and `model`, which it starts on meanwhile.
			 */
			picking?: Promise<Picked>;
		},
		deps: ConversationDeps,
	): Promise<Conversation> {
		const conversation = Conversation.begin(opening, deps, {
			picks: settings,
			model: model ?? null,
		});
		if (picking !== undefined) {
			conversation.state.picking = true;
			conversation.opening = conversation.pick(picking, opening.cwd, {
				model,
				settings,
			});
			return conversation;
		}
		if (model !== undefined) {
			conversation.log.write({ kind: "model-request", model });
		}
		conversation.opening = conversation.wake(opening.agent, opening.cwd);
		return conversation;
	}

	/**
	 * Brings in `session`, one `agent` holds outside splates, such as from its
	 * CLI: loads it in `cwd`, writing what the agent replays of it to a new
	 * log, from which it resumes like any other.
	 */
	static async bring(
		{
			session,
			title,
			...opening
		}: Opening & {
			session: string;
			/** What the agent listed it as, until the replay says otherwise. */
			title: string | null;
		},
		deps: ConversationDeps,
	): Promise<Conversation> {
		const conversation = Conversation.begin(opening, deps, {
			session,
			loading: true,
		});
		conversation.log.write({ kind: "session", session });
		if (title !== null) {
			const update: acp.SessionUpdate = {
				sessionUpdate: "session_info_update",
				title,
			};
			conversation.log.write({ kind: "update", update });
			fold(conversation.state, update);
		}
		conversation.opening = conversation.wake(opening.agent, opening.cwd);
		return conversation;
	}

	/** A new conversation with `agent` in `cwd`, its log begun, not yet opened. */
	private static begin(
		{
			id,
			agent,
			task,
			base = null,
			caller = null,
			cwd,
			log: path,
			assigned = false,
			auto = false,
			startedBy = null,
			skill = null,
		}: Opening,
		deps: ConversationDeps,
		from: From,
	): Conversation {
		const log = new ConversationLog(path, deps.fs, deps.timer);
		const createdAt = new Date(deps.clock.now()).toISOString();
		const state = blank(
			id,
			agent.id,
			task,
			createdAt,
			base,
			caller,
			assigned,
			startedBy,
		);
		state.skill = skill;
		state.auto = auto;
		const conversation = new Conversation(state, log, deps, agent, cwd, from);
		log.write({
			kind: "start",
			id,
			agent: agent.id,
			task,
			cwd,
			base,
			caller,
			createdAt,
			...(assigned ? { assigned } : {}),
			...(auto ? { auto } : {}),
			...(startedBy === null ? {} : { startedBy }),
			...(skill === null ? {} : { skill }),
		});
		return conversation;
	}

	get id(): string {
		return this.state.id;
	}

	/** What runs it; null when its agent is no longer known. */
	get agent(): Agent | null {
		return this.ran;
	}

	/** The agent's pid while it runs, for the commands it left running. */
	get pid(): number | null {
		return this.connection.pid;
	}

	/**
	 * The handle for reattaching after a coordinator restart, or null when
	 * this process cannot survive a restart.
	 */
	get handle(): ProcessHandle | null {
		return this.connection.handle;
	}

	/** The agent's session, once it has opened one. */
	get sessionId(): string | null {
		return this.connection.sessionId;
	}

	/** Where it runs; null for a log too old to say. */
	get cwd(): string | null {
		return this.dir;
	}

	get placedOn(): WorkerMachine | null {
		return this.placed;
	}

	/**
	 * When it was archived, or when it started for a log too old to say; null
	 * while it is not archived.
	 */
	get archivedSince(): string | null {
		return this.state.archived
			? (this.state.archivedAt ?? this.state.createdAt)
			: null;
	}

	/** Whether a checkpoint has ended and nothing has been said since. */
	get stoppedByCheckpoint(): boolean {
		return this.turns.stoppedByCheckpoint;
	}

	now(): string {
		return new Date(this.deps.clock.now()).toISOString();
	}

	/** Says `text` to the agent, with `files` (see `ConversationTurns`). */
	prompt(
		text: string,
		files: Upload[] = [],
		from?: Device,
		opts: PromptOptions = {},
	): Promise<void> {
		// What the person says takes the place of a reconnect still due.
		this.reconnecting?.dispose();
		this.reconnecting = null;
		// And of a question kept from a session they no longer talk to.
		this.unkeep();
		const carry = this.carry;
		if (carry !== null) {
			this.carry = null;
			return this.turns
				.prompt(carry)
				.then(() => this.turns.prompt(text, files, from, opts));
		}
		return this.turns.prompt(text, files, from, opts);
	}

	/** Takes back the `index`th queued message, answering with its words and files. */
	unqueue(index: number): { text: string; files: Attached[] } {
		return this.turns.unqueue(index);
	}

	/** Sends what is queued now, stopping the running turn first. */
	sendNow(): Promise<void> {
		return this.turns.sendNow();
	}

	/** Stops the agent's turn for the person, and stays open for the next. */
	cancel(): Promise<void> {
		return this.turns.cancel();
	}

	/**
	 * Asks the agent to bring its `SPLATES.md` up to date and stop (see
	 * `ConversationTurns`), for `budget`, a worker budget hard stop's reason,
	 * when that is what asks.
	 */
	checkpoint(merging: boolean, budget: string | null = null): Promise<void> {
		return this.turns.checkpoint(merging, { budget });
	}

	/**
	 * Checkpoints the agent for the person, as `checkpoint` does, and leaves
	 * it stopped there: nothing resumes a pause, and Power leaves it alone.
	 */
	pause(merging: boolean): Promise<void> {
		return this.turns.checkpoint(merging, { pause: true });
	}

	/** Forgets the checkpoint, done or not, so the next starts afresh. */
	dismissCheckpoint(): void {
		this.turns.dismissCheckpoint();
	}

	/** Settles once the checkpoint asked is no longer under way. */
	answered(): Promise<void> {
		return this.turns.answered();
	}

	/**
	 * Settles the agent's pending ask, if `id` is still the one it is on.
	 * One kept from an agent a drain freed carries it on instead, the
	 * answer said as the person's words after its task (`free`).
	 */
	answer(id: string, answer: Answer): void {
		const kept = this.kept;
		if (kept === null || kept.id !== id) {
			this.connection.answer(id, answer);
			return;
		}
		this.unkeep();
		const words = answerWords(kept, answer);
		if (words !== null) {
			void this.prompt(words).catch(() => {});
		}
	}

	/** The file `name` the person sent, or null when they sent none by that name. */
	attachment(
		name: string,
	): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
		return this.files.attachment(name, this.state.messages);
	}

	/** Keeps the plan's windows in `limits`, asked of the agent's maker. */
	hear(limits: Limit[]): void {
		if (limits.length === 0) {
			return;
		}
		this.log.write({ kind: "limits", limits });
		this.state.usage = {
			...this.state.usage,
			limits: heard(this.state.usage.limits, limits),
		};
		this.changed();
	}

	/** Stops background command `id`, leaving the agent's turn as it is. */
	stopBackground(id: string): Promise<void> {
		return this.background.stop(id);
	}

	/** What background command `id` has printed, then more as it prints it. */
	backgroundOutput(id: string): ReadableStream<Uint8Array> {
		return this.background.output(id);
	}

	/**
	 * Sets the session's setting `id` to `value`, one the agent offers: at once
	 * while the agent runs, or, while it is stopped, when it next resumes.
	 */
	async choose(id: string, value: string): Promise<void> {
		await this.opening;
		await choose(this, this.connection, id, value);
		this.dispatcher.dispatch("chosen", id);
	}

	/**
	 * Brings a stopped conversation back: a new process, the same session, or
	 * a new one when its agent died before opening one.
	 */
	async resume(): Promise<void> {
		if (this.state.archived) {
			fail("usage", `conversation ${this.id} is archived: unarchive it first`, {
				conversation: this.id,
			});
		}
		if (this.agent === null || this.dir === null) {
			fail(
				"usage",
				`conversation ${this.id} cannot resume: its log predates resuming`,
				{ conversation: this.id },
			);
		}
		// Its task landed or went without the agent's `splates` reaching this
		// server to move it, so it carries on in the main tree.
		if (this.agent.id !== "opencode" && !(await this.there(this.dir))) {
			if (this.deps.root === null) {
				fail(
					"not_found",
					`conversation ${this.id} cannot resume: ${this.dir} is gone`,
					{ conversation: this.id },
				);
			}
			this.move(null, this.deps.root);
		}
		// A start that failed may still be settling: the next one is new.
		await this.opening;
		this.opening ??= this.wake(this.agent, this.dir);
		await this.opening;
	}

	/**
	 * Follows the agent into a task's worktree, or back to the main tree: a
	 * running session keeps the directory it opened in, and the agent works by
	 * absolute path; a resumed one opens in the new.
	 */
	move(
		task: string | null,
		cwd: string,
		base: string | null = null,
		caller: string | null = null,
	): void {
		this.dir = cwd;
		this.log.write({ kind: "task", task, cwd, base, caller });
		this.set({
			task,
			lastTask: task ?? this.state.lastTask,
			lastBase: task === null ? this.state.lastBase : base,
			lastCaller: callerAfter(this.state, task, caller),
		});
	}

	/** Stops the agent; the next prompt resumes where it left off. */
	async stop(): Promise<void> {
		this.reconnecting?.dispose();
		this.reconnecting = null;
		this.unkeep();
		await this.close(null);
	}

	/**
	 * Moves its agent to a new worker once the one it ran on is gone, as a
	 * forced remove or a drain does, so the task carries on from its last
	 * checkpoint. One in no task stays stopped.
	 */
	async requeue(): Promise<void> {
		const { status, task, checkpoint } = this.state;
		const busy =
			status === "running" ||
			status === "starting" ||
			checkpoint === "asked" ||
			// Its process ended first, cut short, as a worker hanging up ends it.
			this.reconnecting !== null;
		// In a new session, since the old one stays on the old worker, told
		// `[SPLATES TASK <task>]` to claim its task from the checkpoint it last
		// pushed: one at work carries on at once, one idle hears it before the
		// person's next words.
		const carry = task === null ? null : taskReference(task);
		// Said before the person can say anything once it has stopped.
		this.carry = busy ? null : carry;
		// Freed already, with the worker.
		this.grant = null;
		this.placed = null;
		await this.close(null);
		this.reconnecting?.dispose();
		this.reconnecting = null;
		this.connection.forgetSession();
		if (busy && carry !== null) {
			await this.turns.prompt(carry);
		}
	}

	/**
	 * Lets go of the slot of an agent asking the person something on a
	 * worker that drains, rather than keep the worker up until they answer,
	 * which may be hours: saves its task as `splates checkpoint` would, since
	 * the agent is mid-turn and cannot, ends it, and keeps its question on
	 * the page. The answer, or whatever the person says instead, places it
	 * again in a new session, told `[SPLATES TASK <task>]` first, as
	 * `requeue` does for an idle one. One in no task has nothing to carry
	 * on from, and one whose task could not be saved would lose work, so
	 * each keeps its slot until answered, as before.
	 */
	private async free(): Promise<void> {
		const { task, ask } = this.state;
		const grant = this.grant;
		const { checkouts } = this.deps;
		if (
			task === null ||
			ask === null ||
			grant === null ||
			checkouts === undefined ||
			this.freeing
		) {
			return;
		}
		this.freeing = true;
		try {
			await checkouts.save(task);
		} catch {
			return;
		} finally {
			this.freeing = false;
		}
		// Answered, stopped or placed elsewhere while it saved.
		if (this.grant !== grant || this.state.ask?.id !== ask.id) {
			return;
		}
		this.kept = ask;
		this.carry = taskReference(task);
		this.placed = null;
		await this.close(null);
		this.connection.forgetSession();
		this.set({ ask });
	}

	/**
	 * Moves its agent off a worker being replaced, at its next pause, so the
	 * worker can update without waiting on the person: one asking does as
	 * `free` says; one idle, nothing running in the background, saves its
	 * task, ends and frees its slot, and the person's next words place it
	 * again in a new session told `[SPLATES TASK <task>]` first, as
	 * `requeue` does for an idle one. One at work moves once its turn ends.
	 * One in no task has nothing to carry on from, and one whose task could
	 * not be saved would lose work, so each keeps its slot until it ends.
	 */
	private async moveOff(): Promise<void> {
		if (this.state.ask !== null) {
			await this.free();
			return;
		}
		const { task, status, background } = this.state;
		const grant = this.grant;
		const { checkouts } = this.deps;
		if (
			task === null ||
			status !== "idle" ||
			background.length > 0 ||
			grant === null ||
			checkouts === undefined ||
			this.freeing
		) {
			return;
		}
		this.freeing = true;
		try {
			await checkouts.save(task);
		} catch {
			return;
		} finally {
			this.freeing = false;
		}
		// Prompted, stopped or placed elsewhere while it saved.
		if (
			this.grant !== grant ||
			this.state.status !== "idle" ||
			this.state.ask !== null
		) {
			return;
		}
		this.carry = taskReference(task);
		this.placed = null;
		await this.close(null);
		this.connection.forgetSession();
	}

	/** Lets go of the question kept by `free`, its session gone. */
	private unkeep(): void {
		if (this.kept === null) {
			return;
		}
		this.kept = null;
		this.set({ ask: null });
	}

	/**
	 * Lets go of the agent's process without ending it, for a coordinator
	 * started again to take back from the worker: its log, flushed, says
	 * where it stopped. Answers whether there was one to let go of; a
	 * conversation with none, or one nothing could take back, stops as ever.
	 */
	async detach(): Promise<boolean> {
		if (this.detached) {
			return true;
		}
		if (!this.connection.connected || this.connection.handle === null) {
			return false;
		}
		this.detached = true;
		this.resting?.dispose();
		this.resting = null;
		await this.connection.detach();
		await this.log.flush();
		return true;
	}

	/**
	 * Stops it and puts it away, off the list of conversations; `with`, the
	 * conversation whose archiving takes it along, which brings it back.
	 * Its artifacts keep only what their panel shows.
	 */
	async archive(withConversation?: string): Promise<void> {
		await this.stop();
		await put(this, { archived: true, with: withConversation });
		await this.artifacts.archive();
	}

	/** Names it `name` over the agent's title; blank goes back to the title. */
	async rename(name: string): Promise<void> {
		const named = name.trim() || null;
		this.log.write({ kind: "rename", name: named });
		await this.log.flush();
		this.set({ name: named });
	}

	/** Back on the list, stopped until the next prompt. */
	async unarchive(): Promise<void> {
		await put(this, { archived: false });
	}

	/** Keeps it atop the list, or lets it go back among the rest. */
	async pin(pinned: boolean): Promise<void> {
		if (this.state.pinned === pinned) {
			return;
		}
		this.log.write({ kind: "pin", pinned });
		await this.log.flush();
		this.set({ pinned });
	}

	/**
	 * Nests it in the list under the conversation `id`, or at the top for
	 * null, over where its task would, cutting it loose from the conversation
	 * that started it or added its task: that one no longer tells it, hears
	 * from it, or archives it along. Never for a subagent, which stays with
	 * the one it answers to.
	 */
	async reparent(id: string | null): Promise<void> {
		if (this.state.parent !== null && this.state.parent.id === id) {
			return;
		}
		const parent = { id };
		this.log.write({ kind: "parent", parent });
		await this.log.flush();
		this.set({ parent, startedBy: null, lastCaller: null });
	}

	/** Settles once everything said so far is in its log, for a reader of the file. */
	async saved(): Promise<void> {
		await this.log.flush();
	}

	/** Marks it seen, or unseen again for the person to come back to. */
	async markUnread(unread: boolean): Promise<void> {
		this.flag(unread);
		await this.log.flush();
	}

	/** Stops it and deletes its log and files, for good. */
	async delete(): Promise<void> {
		await this.stop();
		await this.log.remove();
		await this.files.remove();
	}

	dispose(): void {
		this.resting?.dispose();
		this.reconnecting?.dispose();
		this.unlistenDrain?.();
		void this.stop();
	}

	/** Marks it `unread` or not, keeping how much was seen when it was read. */
	flag(unread: boolean): void {
		if (this.state.unread === unread) {
			return;
		}
		this.log.write({ kind: "unread", unread });
		this.set(unread ? { unread } : { unread, seen: sent(this.state.messages) });
	}

	/** Back to idle once a turn ends, then on to what was queued meanwhile. */
	ended(error: string | null): void {
		if (error === null) {
			this.reconnects = 0;
		}
		this.turns.ended(error);
	}

	/** Ends the agent's process, with `error` for one that failed, and keeps that it stopped. */
	async close(error: string | null): Promise<void> {
		if (this.detached) {
			return;
		}
		this.placing?.abort();
		this.grant?.dispose();
		this.grant = null;
		if (this.state.status === "stopped" || this.state.status === "failed") {
			return;
		}
		this.connection.close();
		const cut = this.turns.interrupt();
		if (this.state.checkpoint === "asked") {
			this.turns.mark("failed");
		}
		this.log.write({ kind: "end", error });
		await this.log.flush();
		this.set({
			status: error === null ? "stopped" : "failed",
			error,
			ask: null,
			background: [],
		});
		// Lost rather than stopped: the person stopping it, or the server
		// shutting down, ends it with no error.
		if (cut && error !== null) {
			this.reconnect();
		}
	}

	/**
	 * Carries on with the turn a lost connection cut short, as the page's
	 * Reconnect button would, once `RECONNECT_WAIT` is up: a worker that comes
	 * back without the agent's process loses it just as it reconnects. After
	 * `RECONNECTS` tries in a row with no turn ending between them, the
	 * button is left to the person.
	 */
	private reconnect(): void {
		const due = () =>
			!this.state.archived &&
			this.state.checkpoint === null &&
			(this.state.status === "stopped" || this.state.status === "failed") &&
			this.state.messages.at(-1)?.interrupted !== undefined;
		if (
			this.reconnecting !== null ||
			this.reconnects >= RECONNECTS ||
			this.agent === null ||
			!due()
		) {
			return;
		}
		this.reconnects += 1;
		this.reconnecting = this.deps.timer.setTimeout(() => {
			this.reconnecting = null;
			if (due()) {
				void this.turns.prompt(RECONNECT).catch(() => {});
			}
		}, RECONNECT_WAIT.multiply(this.reconnects));
	}

	set(next: Partial<ConversationState>): void {
		// Kept, so a log whose process died mid-turn reads back as cut short.
		const running = next.status === "running";
		if (
			next.status !== undefined &&
			running !== (this.state.status === "running")
		) {
			const at = this.now();
			this.log.write({
				kind: "turn",
				running,
				...(this.state.agent === "opencode" ? { at } : {}),
			});
			if (!running) {
				finishObservation(this.state, at);
			}
		}
		Object.assign(this.state, next);
		this.changed();
		// An agent that asks on a worker already draining lets its slot go too,
		// and one whose turn ends on a worker being replaced moves off it.
		if (next.ask != null && this.grant?.drains() === true) {
			void this.free();
		} else if (
			(next.status === "idle" || next.background !== undefined) &&
			this.grant?.replaces() === true
		) {
			void this.moveOff();
		}
	}

	changed(): void {
		this.state.taking = this.turns.taking();
		this.rest();
		this.dispatcher.dispatch("changed");
	}

	/**
	 * Stops an agent left idle `IDLE_STOP`, with no command running in the background,
	 * no question open and no checkpoint, so its process exits and takes what
	 * it started along, MCP servers and browsers included. The next prompt
	 * resumes the same session.
	 */
	private rest(): void {
		const idle = (): boolean => {
			const { status, background, ask, checkpoint } = this.state;
			return (
				status === "idle" &&
				background.every((each) => each.state !== "running") &&
				ask === null &&
				checkpoint === null
			);
		};
		if (!idle()) {
			this.resting?.dispose();
			this.resting = null;
			return;
		}
		this.resting ??= this.deps.timer.setTimeout(() => {
			this.resting = null;
			if (idle()) {
				void this.stop().then(() => this.set({ stoppedIdle: this.now() }));
			}
		}, IDLE_STOP);
	}

	/**
	 * Whether `dir` is still there: on the worker it was placed on, or for a
	 * task cloned on a worker, taken to be, since the placement finds or
	 * makes its clone again; else on this machine.
	 */
	private async there(dir: string): Promise<boolean> {
		const { task } = this.state;
		const { checkouts, fs } = this.deps;
		if (this.placed !== null) {
			return this.placed.exists(dir).catch(() => true);
		}
		return (
			(await fs.exists(dir)) ||
			(task !== null && checkouts !== undefined
				? await checkouts.elsewhere(task).catch(() => false)
				: false)
		);
	}

	/**
	 * Opens on what Auto picks once it has, or, when the pick fails, on what
	 * the conversation started on; opens nothing when it was stopped while
	 * Auto picked. The model is asked for only now, so a log read back
	 * mid-pick asks for none the pick may not keep.
	 */
	private async pick(
		picking: Promise<Picked>,
		cwd: string,
		started: Omit<Picked, "agent">,
	): Promise<void> {
		const picked = await picking.catch(() => null);
		const { agent, model, settings } = picked ?? {
			...started,
			agent: this.ran as Agent,
		};
		if (agent.id !== this.state.agent) {
			this.ran = agent;
			runOn(this.state, agent.id);
			this.log.write({ kind: "agent", agent: agent.id });
		}
		if (model !== undefined) {
			this.log.write({ kind: "model-request", model });
		}
		this.connection.openOn(model ?? null, settings);
		this.state.picking = false;
		this.changed();
		if (this.state.status !== "starting") {
			this.opening = null;
			return;
		}
		await this.wake(agent, cwd);
	}

	/**
	 * Opens the agent in `cwd` once it has a slot, clearing `opening` once it
	 * has, failed to, or was stopped while it waited for one. On a worker
	 * other than this machine's it opens in its checkout there instead.
	 */
	private async wake(agent: Agent, cwd: string): Promise<void> {
		try {
			const placement = await this.place();
			if (placement === null) {
				return;
			}
			this.placed = placement?.machine ?? null;
			const at = await this.checkout(placement, cwd);
			if (at !== null) {
				await this.connection.open(agent, at, placement?.launch);
			}
		} finally {
			this.opening = null;
		}
	}

	/**
	 * Where its agent opens on the worker `placement` names: `cwd` on this
	 * machine's, or with no placement; else the checkout `PlacedCheckouts`
	 * finds or readies there, which it then runs in. Null once readying it
	 * failed, which fails the conversation.
	 */
	private async checkout(
		placement: Placement | undefined,
		cwd: string,
	): Promise<string | null> {
		const { checkouts } = this.deps;
		if (placement?.machine == null || checkouts === undefined) {
			return cwd;
		}
		try {
			const at = await checkouts.where(
				placement.worker,
				placement.machine,
				this.state.task,
			);
			this.dir = at;
			return at;
		} catch (error) {
			await this.close(
				`could not ready a checkout on worker ${placement.worker}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
	}

	/**
	 * Waits in the queue for a slot for its agent, keeping where it waits in
	 * its state: its placement on the worker it was placed on, undefined with
	 * no queue, or null once a stop takes it out of line. Slots cap how many
	 * agents agents start, never how many the person does: the person's go
	 * uncapped, waiting only while no worker they can run on is up.
	 */
	private async place(): Promise<Placement | undefined | null> {
		const { slots } = this.deps;
		if (slots === undefined) {
			return undefined;
		}
		this.grant?.dispose();
		this.grant = null;
		const { id, task, agent } = this.state;
		const placing = new AbortController();
		this.placing = placing;
		this.set({ status: "starting", error: null });
		const unlisten = slots.events.on("changed", () =>
			this.queued(slots.spot(id)),
		);
		try {
			const placement = await slots.take(
				{ id, task, agent, uncapped: !spawned(this.state) },
				placing.signal,
			);
			this.grant = placement;
			placement.lost.addEventListener(
				"abort",
				() => {
					if (this.grant === placement) {
						void this.requeue().catch(() => {});
					}
				},
				{ once: true },
			);
			return placement;
		} catch (error) {
			if (placing.signal.aborted) {
				return null;
			}
			throw error;
		} finally {
			unlisten();
			if (this.placing === placing) {
				this.placing = null;
			}
			this.queued(null);
		}
	}

	/** Keeps where its agent waits for a slot, saying so only when that changed. */
	private queued(spot: QueueSpot | null): void {
		const was = this.state.queue;
		if (
			was === spot ||
			(was !== null &&
				spot !== null &&
				was.position === spot.position &&
				was.of === spot.of &&
				was.reason === spot.reason)
		) {
			return;
		}
		this.set({ queue: spot });
	}
}

/** Whether another agent started it, handing it its task, rather than the person. */
function spawned(state: ConversationState): boolean {
	return state.startedBy !== null;
}

/** What a conversation is opened with, started afresh or brought in. */
interface Opening {
	id: string;
	agent: Agent;
	task: string | null;
	/** The branch `task` was cut from. */
	base?: string | null;
	/** The conversation whose agent added `task`. */
	caller?: string | null;
	cwd: string;
	log: string;
	/** Started on what a queued task or `splates add --agent` assigned. */
	assigned?: boolean;
	/** Started on what Auto picked. */
	auto?: boolean;
	/** The lane orchestrator that handed it its task, which hears when it stops. */
	startedBy?: string | null;
	/** The project's splates skill version as it starts; null when it has none. */
	skill?: string | null;
}

/** What Auto picked for a conversation to open on, its agent as `A` names it. */
export interface Picked<A = Agent> {
	agent: A;
	/** The model to pick, as `Conversation.start` takes it; none for the agent's default. */
	model?: string;
	/** Values to set, by setting id, once the session offers them. */
	settings: Record<string, string>;
}

/** What a conversation starts from, beyond its state: what its log or its caller said. */
interface From {
	/** Original cwd required by OpenCode recovery. */
	sessionCwd?: string | null;
	/** The agent's session, for one read back or brought in. */
	session?: string | null;
	/** Whether the first open loads `session`, replaying it, rather than resuming it. */
	loading?: boolean;
	/** Settings to set, by id, once the session offers them. */
	picks?: Record<string, string>;
	/** The model to pick once the session offers it. */
	model?: string | null;
}
