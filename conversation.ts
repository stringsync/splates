// scry-ignore-file compact-files: the conversation lifecycle coordinates its delegated turns, files, connection, and log as one public object.
import type * as acp from "@agentclientprotocol/sdk";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { AgentConnection } from "./agent-connection";
import type { Agent, AgentProcess, ProcessHandle } from "./agent-process";
import { Artifacts, applyArtifact } from "./artifacts";
import { put } from "./conversation-archive";
import { ConversationBackground } from "./conversation-background";
import { choose } from "./conversation-choice";
import { ConversationFiles } from "./conversation-files";
import type {
	ConversationDeps,
	ConversationEvents,
	ConversationHost,
} from "./conversation-host";
import { ConversationLog, type Live } from "./conversation-log";
import { sent } from "./conversation-messages";
import {
	type Answer,
	type Attached,
	blank,
	type ConversationState,
	callerAfter,
	type Device,
	IDLE_STOP,
	type Limit,
	type Upload,
} from "./conversation-state";
import { ConversationTurns, type PromptOptions } from "./conversation-turns";
import { fail } from "./exit";
import { fold, heard } from "./fold";
import { finishObservation } from "./opencode-usage";

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
	/** Let go of its process for a restart: nothing here ends it now. */
	private detached = false;

	private constructor(
		readonly state: ConversationState,
		readonly log: ConversationLog,
		private readonly deps: ConversationDeps,
		/** What to run to resume it; null when its agent is no longer known. */
		readonly agent: Agent | null,
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
		let taken: { process: AgentProcess; live: Live } | null = null;
		if (replayed.live !== null) {
			const { live } = replayed;
			try {
				if (agent !== null) {
					taken = {
						process: deps.launcher.resume(live.handle, live.held),
						live,
					};
				}
			} catch {
				// Nothing here runs it any more: stopped, as any dead process is.
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
		if (taken !== null && agent !== null) {
			conversation.connection.reattach(agent, taken.process, taken.live);
		}
		return conversation;
	}

	/** Starts `agent` in `cwd` and opens a session with it. */
	static async start(
		{
			settings = {},
			model,
			...opening
		}: Opening & {
			/** Values to set, by setting id, once the session offers them. */
			settings?: Record<string, string>;
			/**
			 * The model to pick, by its value or name in the session's model
			 * setting, over what `settings` says. An unavailable choice fails.
			 */
			model?: string;
		},
		deps: ConversationDeps,
	): Promise<Conversation> {
		const conversation = Conversation.begin(opening, deps, {
			picks: settings,
			model: model ?? null,
		});
		if (model !== undefined) {
			conversation.log.write({ kind: "model-request", model });
		}
		conversation.opening = conversation.wake(opening.agent, opening.cwd);
		return conversation;
	}

	/**
	 * Brings in `session`, one `agent` holds outside arbor, such as from its
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
			handedBy = null,
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
			handedBy,
			startedBy,
		);
		state.skill = skill;
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
			...(handedBy === null ? {} : { handedBy }),
			...(startedBy === null ? {} : { startedBy }),
			...(skill === null ? {} : { skill }),
		});
		return conversation;
	}

	get id(): string {
		return this.state.id;
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

	/** Asks the agent to bring its `ARBOR.md` up to date and stop (see `ConversationTurns`). */
	checkpoint(merging: boolean): Promise<void> {
		return this.turns.checkpoint(merging);
	}

	/**
	 * Checkpoints the agent for the person, as `checkpoint` does, and leaves
	 * it stopped there: nothing resumes a pause, and Power leaves it alone.
	 */
	pause(merging: boolean): Promise<void> {
		return this.turns.checkpoint(merging, true);
	}

	/** Forgets the checkpoint, done or not, so the next starts afresh. */
	dismissCheckpoint(): void {
		this.turns.dismissCheckpoint();
	}

	/** Settles once the checkpoint asked is no longer under way. */
	answered(): Promise<void> {
		return this.turns.answered();
	}

	/** Settles the agent's pending ask, if `id` is still the one it is on. */
	answer(id: string, answer: Answer): void {
		this.connection.answer(id, answer);
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
		// Its task landed or went without the agent's `arbor` reaching this
		// server to move it, so it carries on in the main tree.
		if (
			this.agent.id !== "opencode" &&
			!(await this.deps.fs.exists(this.dir))
		) {
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
		await this.close(null);
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
		this.turns.ended(error);
	}

	/** Ends the agent's process, with `error` for one that failed, and keeps that it stopped. */
	async close(error: string | null): Promise<void> {
		if (
			this.detached ||
			this.state.status === "stopped" ||
			this.state.status === "failed"
		) {
			return;
		}
		this.connection.close();
		this.turns.interrupt();
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

	/** Opens the agent in `cwd`, clearing `opening` once it has or failed to. */
	private wake(agent: Agent, cwd: string): Promise<void> {
		return this.connection.open(agent, cwd).finally(() => {
			this.opening = null;
		});
	}
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
	/** Started on what a todo or `arbor add --agent` assigned. */
	assigned?: boolean;
	/** The conversation that handed it its task, which it answers to. */
	handedBy?: string | null;
	/** The lane orchestrator that handed it its task, which hears when it stops. */
	startedBy?: string | null;
	/** The project's arbor skill version as it starts; null when it has none. */
	skill?: string | null;
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
