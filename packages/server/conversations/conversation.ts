// scry-ignore-file compact-files: the conversation lifecycle coordinates its delegated turns, files, connection, and log as one public object.
import type * as acp from "@agentclientprotocol/sdk";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration } from "webappwiz/time";
import type { Agent, AgentProcess, ProcessHandle } from "../agents";
import { AgentConnection, endBackground, fold, heard } from "../agents";
import { Artifacts, applyArtifact } from "../artifacts";
import { fail } from "../exit";
import { finishObservation } from "../models";
import { handOffReference, RECONNECT, taskReference } from "../plans";
import type { Grant } from "../workers";
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
import { ConversationLog, type Entry, type Live } from "./log";
import { sent } from "./messages";
import {
	type Answer,
	type Ask,
	type Attached,
	type AutoPickSet,
	blank,
	type ConversationState,
	callerAfter,
	type Device,
	IDLE_STOP,
	type Limit,
	type QueueSpot,
	runOn,
	SERVER_TOLD,
	switched,
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
	/** Set when it left its task's worktree mid-turn: stop once the turn ends. */
	private leftWorktree = false;
	/** Says `[SPLATES RECONNECT]` once its wait is up; null while none is due. */
	private reconnecting: Resource | null = null;
	/** How many times in a row it has reconnected by itself. */
	private reconnects = 0;
	/** Let go of its process for a restart: nothing here ends it now. */
	private detached = false;
	/**
	 * Read back with what was said while it started still unheard, the
	 * server having gone down first: `sayUnsaid` starts it again to say it.
	 */
	private unsaid = false;
	/** The place its agent holds on a worker; null while it has none. */
	private grant: Grant | null = null;
	/** Takes its agent out of the queue for a place; null while it waits in none. */
	private placing: AbortController | null = null;
	/**
	 * Lets a held one go, to open its agent, or not, once stopped; null
	 * while it is not held.
	 */
	private latch: ((go: boolean) => void) | null = null;
	/**
	 * What its next prompt is to follow, for an agent taken off a worker
	 * while idle: its new session knows nothing of the task. Null for none.
	 */
	private carry: string | null = null;
	/**
	 * The question its agent was asking when a drain freed its place, kept
	 * on the page for the person to answer (`free`); null for none.
	 */
	private kept: Ask | null = null;
	/** Stops hearing of workers that start draining; null with no placer. */
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
		this.files = new ConversationFiles(deps.storage, state.id, {
			projects: deps.projects,
			home: deps.root,
		});
		this.artifacts = new Artifacts(deps.storage, state.id, {
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
			deps.placer?.events.on("drain", (worker) => {
				if (this.grant?.worker === worker) {
					void (this.grant.replaces() ? this.moveOff() : this.free());
				}
			}) ?? null;
	}

	/**
	 * A conversation as its log at `key` left it: stopped, whatever it was
	 * doing, unless its agent still runs on a worker, which the launcher
	 * takes back, and the conversation carries on where the log leaves off.
	 */
	static async read(
		key: string,
		agents: Agent[],
		deps: ConversationDeps,
	): Promise<Conversation | null> {
		const log = new ConversationLog(deps.storage.log<Entry>(key), deps.timer);
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
		conversation.unsaid = replayed.unsaid === true && taken === null;
		if (taken !== null && agent !== null) {
			conversation.grant = taken.hold;
			conversation.connection.reattach(agent, taken.process, taken.live);
		}
		return conversation;
	}

	/**
	 * The agent `live` names, taken back on the worker it runs on, holding
	 * its place there; null when nothing here runs it any more, stopped as
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
				deps.placer?.hold(
					{
						id: state.id,
						task: state.task,
						agent: state.agent,
						automatic: spawned(state),
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
			 * What Auto pick decides, once it has, to open on in place of
			 * `agent`, `settings` and `model`, which it shows meanwhile.
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
		conversation.request(settings);
		if (opening.queued === undefined) {
			conversation.opening = conversation.wake(opening.agent, opening.cwd);
		} else {
			conversation.hold();
		}
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
			scratch = false,
			assigned = false,
			startedBy = null,
			automatic = false,
			skill = null,
			queued,
			title = null,
			persistent,
			automation,
			ship,
		}: Opening,
		deps: ConversationDeps,
		from: From,
	): Conversation {
		const log = new ConversationLog(
			deps.storage.log<Entry>(`${id}.jsonl`),
			deps.timer,
		);
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
			scratch,
		);
		state.skill = skill;
		state.automatic = automatic;
		state.queued = queued ?? null;
		state.title = title;
		if (persistent !== undefined) {
			state.persistent = persistent;
		}
		if (automation !== undefined) {
			state.automation = automation;
		}
		if (ship !== undefined) {
			state.ship = ship;
		}
		const conversation = new Conversation(state, log, deps, agent, cwd, from);
		log.write({
			kind: "start",
			id,
			agent: agent.id,
			task,
			cwd,
			...(scratch ? { scratch: true as const } : {}),
			base,
			caller,
			createdAt,
			...(assigned ? { assigned } : {}),
			...(startedBy === null ? {} : { startedBy }),
			...(automatic ? { automatic } : {}),
			...(skill === null ? {} : { skill }),
			...(queued === undefined ? {} : { queued }),
			...(persistent === undefined ? {} : { persistent }),
			...(automation === undefined ? {} : { automation }),
			...(ship === undefined ? {} : { ship }),
		});
		if (title !== null) {
			const update: acp.SessionUpdate = {
				sessionUpdate: "session_info_update",
				title,
			};
			log.write({ kind: "update", update });
		}
		return conversation;
	}

	get id(): string {
		return this.state.id;
	}

	/** What runs it; null when its agent is no longer known. */
	get agent(): Agent | null {
		return this.ran;
	}

	/** Whether the agent takes images, as it said connecting; null while not connected. */
	get sees(): boolean | null {
		return this.connection.connected ? this.connection.sees : null;
	}

	/** The agent's pid while it runs, for the commands it left running. */
	get pid(): number | null {
		return this.connection.pid;
	}

	/**
	 * The handle for reattaching after a server restart, or null when
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

	/** Keeps what Auto pick set it to, as it started. */
	autoPicked(pick: AutoPickSet): void {
		this.log.write({ kind: "auto-pick", pick, at: this.now() });
		this.set({ autoPick: { ...pick, overridden: false } });
	}

	/**
	 * Switches Auto pick `on` for its model and effort, to judge what the
	 * person says next, or off, leaving them as they are.
	 */
	switchAutoPick(on: boolean): void {
		const autoPick = switched(this.state, on);
		if (autoPick === this.state.autoPick) {
			return;
		}
		this.log.write({ kind: "auto-pick-switch", on, at: this.now() });
		this.set({ autoPick });
	}

	async lift(
		settings: Record<string, string>,
		pick: AutoPickSet,
	): Promise<void> {
		for (const [id, value] of Object.entries(settings)) {
			await choose(this, this.connection, id, value, true);
		}
		this.log.write({ kind: "auto-pick", pick, lifted: true, at: this.now() });
		this.set({ autoPick: { ...pick, overridden: false } });
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
		// A running session keeps the directory it opened in, which a merge
		// deletes under it. At the turn's end it stops, so the next prompt
		// resumes in the new one.
		this.leftWorktree =
			task === null &&
			this.dir !== cwd &&
			this.state.status === "running" &&
			this.agent?.id !== "opencode";
		this.dir = cwd;
		this.log.write({ kind: "task", task, cwd, base, caller });
		this.set({
			task,
			lastTask: task ?? this.state.lastTask,
			lastBase: task === null ? this.state.lastBase : base,
			lastCaller: callerAfter(this.state, task, caller),
		});
	}

	/**
	 * Holds it for its queued task, out of the line for a place, until
	 * `release` gives it the task: what is said to it meanwhile waits for
	 * its agent, as while any agent starts. A stopped one, as a held one
	 * reads back after a restart, is held again; one held already, or under
	 * way, is left as it is.
	 */
	hold(): void {
		const { agent, dir } = this;
		if (
			this.latch !== null ||
			this.opening !== null ||
			this.state.queued === null ||
			this.state.archived ||
			agent === null ||
			dir === null
		) {
			return;
		}
		const { promise, resolve } = Promise.withResolvers<boolean>();
		this.latch = resolve;
		this.set({ status: "starting", error: null });
		this.opening = (async () => {
			try {
				// In the dir it was released into, its task's worktree.
				if ((await promise) && this.dir !== null) {
					await this.wake(agent, this.dir);
				}
			} finally {
				this.opening = null;
			}
		})();
	}

	/** Whether it is held for its queued task now (`hold`). */
	get held(): boolean {
		return this.latch !== null;
	}

	/**
	 * Gives a held one its task, the queue having started it in `cwd`: it
	 * follows the task there and takes its place in the line for a place.
	 */
	release(
		task: string,
		cwd: string,
		base: string | null = null,
		caller: string | null = null,
	): void {
		this.move(task, cwd, base, caller);
		this.log.write({ kind: "queued", queued: null });
		this.set({ queued: null, queue: null });
		this.letGo(true);
	}

	/** Keeps where a held one stands in the queue of tasks, as the queue says it. */
	waitsAt(spot: QueueSpot): void {
		if (this.latch !== null) {
			this.queued(spot);
		}
	}

	/** Lets a held one go, to open its agent or to stop. */
	private letGo(go: boolean): void {
		const latch = this.latch;
		this.latch = null;
		latch?.(go);
	}

	/** Stops the agent; the next prompt resumes where it left off. */
	async stop(): Promise<void> {
		await this.halt(false);
	}

	/**
	 * Stops it as the server goes down. One still starting, as while it
	 * waits for a place, keeps that unsaid, with whatever was said to it yet
	 * to reach its agent, so the next run starts it again and says it, as
	 * though the server had stayed up.
	 */
	async shutDown(): Promise<void> {
		await this.halt(this.state.status === "starting" && this.latch === null);
	}

	/**
	 * Starts it again when it was read back with what was said while it
	 * started still unheard (`shutDown`), saying it once the session opens;
	 * one read back any other way waits for the person.
	 */
	sayUnsaid(): void {
		if (!this.unsaid) {
			return;
		}
		this.unsaid = false;
		void this.turns.sayUnsaid().catch(() => {});
	}

	/** Stops the agent, leaving what it was told `unsaid` for the next run or not. */
	private async halt(unsaid: boolean): Promise<void> {
		this.reconnecting?.dispose();
		this.reconnecting = null;
		this.unkeep();
		await this.close(null, { unsaid });
	}

	/** Keeps `picks`, to set once the session opens, through a restart before it does. */
	private request(picks: Record<string, string>): void {
		if (Object.keys(picks).length > 0) {
			this.log.write({ kind: "picks-request", picks });
		}
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
		await this.close(null);
		this.reconnecting?.dispose();
		this.reconnecting = null;
		this.connection.forgetSession();
		if (busy && carry !== null) {
			await this.turns.prompt(carry);
		}
	}

	/**
	 * Starts its agent again in a new session on its task, for one stuck or
	 * dead there: the old session ends, and the new one is told to claim the
	 * task, with what the old one said last kept for it to read.
	 */
	async restart(): Promise<void> {
		const task = this.onTask("restart");
		const transcript = await this.files.keepTranscript(this.state.messages);
		await this.stop();
		this.connection.forgetSession();
		await this.prompt(handOffReference(task, transcript), [], undefined, {
			told: SERVER_TOLD,
		});
	}

	/** Keeps what was said so far for another agent to read, answering where it opens. */
	keepTranscript(): Promise<string> {
		return this.files.keepTranscript(this.state.messages);
	}

	/**
	 * Lets go of its task for another agent to take on: stops its agent and
	 * moves it to the main tree, where it resumes if prompted again, and
	 * answers the prompt that has the next agent claim the task, with what
	 * this one said last kept for it to read.
	 */
	async handOff(): Promise<string> {
		const task = this.onTask("hand off");
		const { root } = this.deps;
		if (root === null) {
			fail("usage", `conversation ${this.id} has no main tree to move to`, {
				conversation: this.id,
			});
		}
		const transcript = await this.files.keepTranscript(this.state.messages);
		await this.stop();
		this.move(null, root);
		return handOffReference(task, transcript);
	}

	/** Its task, for `doing` that needs one; refused when it is in none. */
	private onTask(doing: string): string {
		const { task, archived } = this.state;
		if (task === null || archived) {
			fail(
				"usage",
				`conversation ${this.id} is in no task: only one on a task can ${doing}`,
				{ conversation: this.id },
			);
		}
		return task;
	}

	/**
	 * Lets go of the place of an agent asking the person something on a
	 * worker that drains, rather than keep the worker up until they answer,
	 * which may be hours: ends it, its worktree left as it stands, and keeps
	 * its question on the page. The answer, or whatever the person says
	 * instead, places it again in a new session, told `[SPLATES TASK <task>]`
	 * first, as `requeue` does for an idle one. One in no task has nothing
	 * to carry on from, so it keeps its place until answered.
	 */
	private async free(): Promise<void> {
		const { task, ask } = this.state;
		if (task === null || ask === null || this.grant === null) {
			return;
		}
		this.kept = ask;
		this.carry = taskReference(task);
		await this.close(null);
		this.connection.forgetSession();
		this.set({ ask });
	}

	/**
	 * Moves its agent off a worker being replaced, at its next pause, so the
	 * worker can update without waiting on the person: one asking does as
	 * `free` says; one idle, nothing running in the background, ends and
	 * frees its place, and the person's next words place it again in a new
	 * session told `[SPLATES TASK <task>]` first, as `requeue` does for an
	 * idle one. One at work moves once its turn ends. One in no task has
	 * nothing to carry on from, so it keeps its place until it ends.
	 */
	private async moveOff(): Promise<void> {
		if (this.state.ask !== null) {
			await this.free();
			return;
		}
		const { task, status, background } = this.state;
		if (
			task === null ||
			status !== "idle" ||
			background.length > 0 ||
			this.grant === null
		) {
			return;
		}
		this.carry = taskReference(task);
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
	 * Lets go of the agent's process without ending it, for a server
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
	 * conversation whose archiving takes it along, which brings it back;
	 * `rest`, a persistent agent's run ended with its role still on.
	 * Its artifacts keep only what their panel shows.
	 */
	async archive(
		withConversation?: string,
		{ rest = false }: { rest?: boolean } = {},
	): Promise<void> {
		await this.stop();
		await put(this, { archived: true, with: withConversation, rest });
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

	/**
	 * Keeps that the person has read `read` of its messages, never fewer than
	 * before nor more than went out.
	 */
	async markRead(read: number): Promise<void> {
		const count = Math.min(
			Math.max(Math.floor(read), this.state.read ?? 0),
			sent(this.state.messages),
		);
		if (count === this.state.read) {
			return;
		}
		this.log.write({ kind: "read", read: count });
		this.set({ read: count });
		await this.log.flush();
	}

	/** Stops it and deletes its log and files, for good. */
	async delete(): Promise<void> {
		await this.stop();
		await this.log.remove();
		await this.files.remove();
		// Its artifacts too, kept under its id beside its log.
		await this.deps.storage.remove(this.id);
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

	/** Marks whether a run its eval card started is going. */
	evaluate(running: boolean): void {
		if ((this.state.evaluating ?? false) === running) {
			return;
		}
		if (running) {
			this.state.evaluating = true;
		} else {
			delete this.state.evaluating;
		}
		this.changed();
	}

	/** Back to idle once a turn ends, then on to what was queued meanwhile. */
	ended(error: string | null): void {
		if (error === null) {
			this.reconnects = 0;
		}
		this.turns.ended(error);
	}

	/**
	 * Ends the agent's process, with `error` for one that failed, and keeps
	 * that it stopped, and whether what it was told is left `unsaid`, for the
	 * next run to say.
	 */
	async close(
		error: string | null,
		{ unsaid = false }: { unsaid?: boolean } = {},
	): Promise<void> {
		if (this.detached) {
			return;
		}
		this.placing?.abort();
		this.grant?.dispose();
		this.grant = null;
		this.letGo(false);
		if (this.state.status === "stopped" || this.state.status === "failed") {
			return;
		}
		this.connection.close();
		const cut = this.turns.interrupt();
		if (this.state.checkpoint === "asked") {
			this.turns.mark("failed");
		}
		this.log.write({
			kind: "end",
			error,
			...(unsaid ? { unsaid: true as const } : {}),
		});
		await this.log.flush();
		endBackground(this.state, this.now());
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
		if (next.status === "idle" && this.leftWorktree) {
			this.leftWorktree = false;
			void this.stop().then(() => this.set({ stoppedIdle: this.now() }));
		}
		// An agent that asks on a worker already draining lets its place go too,
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

	/** Whether `dir` is still there. */
	private there(dir: string): Promise<boolean> {
		return this.deps.fs.exists(dir);
	}

	/**
	 * Opens on what Auto pick decides once it has, or, when the pick fails,
	 * on what the conversation started on; opens nothing when it was stopped
	 * meanwhile. The model is asked for only now, so a log read back mid-pick
	 * asks for none the pick may not keep.
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
		this.request(settings);
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
	 * Opens the agent in `cwd` once it has a place, clearing `opening` once it
	 * has, failed to, or was stopped while it waited for one.
	 */
	private async wake(agent: Agent, cwd: string): Promise<void> {
		try {
			if (this.state.scratch === true) {
				await this.deps.machine.scratch(agent.id, cwd);
			}
			const placement = await this.place();
			if (placement === null) {
				return;
			}
			await this.connection.open(agent, cwd, placement?.launch);
		} finally {
			this.opening = null;
		}
	}

	/**
	 * Waits in the queue for a worker for its agent, keeping where it waits
	 * in its state: its placement on the worker it was placed on, undefined
	 * with no queue, or null once a stop takes it out of line. An automatic
	 * one also waits while starts are paused; the person's own wait only
	 * while no worker they can run on is up.
	 */
	private async place(): Promise<Placement | undefined | null> {
		const { placer } = this.deps;
		if (placer === undefined) {
			return undefined;
		}
		this.grant?.dispose();
		this.grant = null;
		const { id, task, agent } = this.state;
		const placing = new AbortController();
		this.placing = placing;
		this.set({ status: "starting", error: null });
		const unlisten = placer.events.on("changed", () =>
			this.queued(placer.spot(id)),
		);
		try {
			const placement = await placer.take(
				{ id, task, agent, automatic: spawned(this.state) },
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

	/** Keeps where its agent waits for a place, saying so only when that changed. */
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

/**
 * Whether splates started it, from the queue or a hook, rather than the
 * person; an older one a lane's orchestrator started counts too.
 */
function spawned(state: ConversationState): boolean {
	return state.automatic || state.startedBy !== null;
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
	/** Runs projectless in its own scratch workspace. */
	scratch?: boolean;
	/** Started on what a queued task or `splates add --agent` assigned. */
	assigned?: boolean;
	/** The lane orchestrator that handed it its task, which hears when it stops. */
	startedBy?: string | null;
	/** Whether the server's queue or a hook starts it, so it waits while starts are paused. */
	automatic?: boolean;
	/** The project's splates skill version as it starts; null when it has none. */
	skill?: string | null;
	/** The queued task it is held for until the queue starts it (`hold`). */
	queued?: number;
	/** What to call it until its agent names it. */
	title?: string | null;
	/** The persistent agent's role it is started for, as `"groomer"`. */
	persistent?: string;
	/** The automation that starts it, by its id. */
	automation?: string;
	/** The ship whose adoption task it runs, by its id. */
	ship?: string;
}

/** What Auto pick decided for a conversation to open on, its agent as `A` names it. */
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
