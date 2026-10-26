import type { Events } from "webappwiz/events";
import type { IdProvider } from "webappwiz/id";
import type { Fs, Lock } from "webappwiz/system";
import type { Timer, WallClock } from "webappwiz/time";
import type { Agent, Launch, Launcher, SessionServers, Watch } from "../agents";
import type { ArtifactLimits, ArtifactRoom } from "../artifacts";
import type { Reach } from "../projects";
import type { Storage } from "../storage";
import type { Grant, WorkerMachine } from "../workers";
import type { ConversationLog } from "./log";
import type {
	AutoPickSet,
	ConversationState,
	Message,
	QueueSpot,
} from "./state";

/**
 * What a conversation's parts, its connection, its turns and its background
 * commands, share of it: its state and log, and the few things they do to
 * the whole. `Conversation` implements it.
 */
export interface ConversationHost {
	readonly state: ConversationState;
	readonly log: ConversationLog;
	readonly events: Events<ConversationEvents>;
	/** What runs it; null when its agent is no longer known. */
	get agent(): Agent | null;
	/** Where it runs; null for a log too old to say. */
	readonly cwd: string | null;
	/** Under way while the agent starts or comes back, for a prompt to wait on. */
	readonly opening: Promise<void> | null;
	now(): string;
	set(next: Partial<ConversationState>): void;
	changed(): void;
	/** A turn ended, with `error` for one that failed. */
	ended(error: string | null): void;
	/** Ends the agent's process, with `error` for one that failed. */
	close(error: string | null): Promise<void>;
	/** Brings a stopped conversation back: a new process, the same session or a new one. */
	resume(): Promise<void>;
	/** Back on the list, stopped until the next prompt. */
	unarchive(): Promise<void>;
	/** Marks it `unread` or not. */
	flag(unread: boolean): void;
	/** Sets `settings`, by id, as Auto pick moves it up to `pick`. */
	lift(settings: Record<string, string>, pick: AutoPickSet): Promise<void>;
}

/**
 * Auto pick's second look at `said`, what the person says next in
 * `conversation`, before its agent reads it: it may move the conversation
 * up with `lift`.
 */
export type Lift = (
	conversation: ConversationHost,
	said: readonly Message[],
) => Promise<void>;

/**
 * The note pointers for `said`, what the person says next in
 * `conversation`, to follow it to the agent; null to attach none.
 */
export type Route = (
	conversation: ConversationHost,
	said: readonly Message[],
) => Promise<string | null>;

/**
 * What looks back, once a turn of `conversation` that began at `since` has
 * ended, at what its agent did with the notes it read in it.
 */
export type Weigh = (
	conversation: Pick<ConversationHost, "state" | "cwd">,
	since: string,
) => Promise<void>;

export type ConversationEvents = { changed: undefined; chosen: string };

/** What every conversation in a repo is made with. */
export interface ConversationDeps {
	fs: Fs;
	/**
	 * Where every conversation of the repo is kept: its log as `<id>.jsonl`,
	 * the files the person sent in it as the collection `<id>`.
	 */
	storage: Storage;
	/**
	 * Where those sit on this machine, for an agent to open: its artifacts,
	 * which are not on storage yet, among them.
	 */
	dir: string;
	/** What names the files artifacts are kept in. */
	ids: IdProvider;
	/** How many bytes of artifacts it may keep (`artifacts.ts`). */
	artifacts: ArtifactLimits;
	/** What makes room for an add across the project; none refuses one past it. */
	room?: ArtifactRoom;
	timer: Timer;
	clock: WallClock;
	/** What starts each agent, and takes one back after a restart. */
	launcher: Launcher;
	/**
	 * Where each agent waits for a slot on a worker before it starts, and
	 * starts there: one another agent started for a free one, one the person
	 * started for any worker up. With none, every one starts at once on
	 * `launcher`.
	 */
	slots?: ConversationSlots;
	/** Where the agent runs, which its background commands' output is read from. */
	machine: WorkerMachine;
	/**
	 * Hold it while an agent's process starts, until it is done
	 * opening its session, so agents start one at a time.
	 */
	// Agents launched through `bunx` at once race in its install, and most die.
	starting: Lock;
	/** Where `splates server` answers, for the agent's CLI to tell it things. */
	url: string | null;
	/** What watches the agent's commands; null to leave them be. */
	watch: Watch | null;
	/** The main tree, where a conversation carries on once its worktree is gone. */
	root: string | null;
	/** The splates projects on this machine, for `#slug`; null for none. */
	projects: ProjectRoster | null;
	/** The MCP servers each session is offered, beyond the agent's own; null for none. */
	servers: SessionServers | null;
	/** What looks again at what the person says in a conversation Auto pick started; null for nothing. */
	lift?: Lift | null;
	/** What points the agent at the project notes that bear on what the person says; null for nothing. */
	route?: Route | null;
}

/** A project's way into the machine's queue for worker slots (`Scheduler`). */
export interface ConversationSlots {
	/**
	 * A slot for the agent of conversation `id`, once its turn comes;
	 * aborting `signal` takes it out of the queue, rejecting.
	 */
	take(request: SlotAsk, signal: AbortSignal): Promise<Placement>;
	/**
	 * Counts an agent already running on `worker` against its slots, and
	 * reaches it there; throws for a worker this server no longer knows.
	 */
	hold(request: SlotAsk, worker: string): Hold;
	/** Where the agent of conversation `id` waits; null for one not waiting. */
	spot(id: string): QueueSpot | null;
	/**
	 * `changed` as the queue or the slots held change; `drain` with a
	 * worker's id once it starts draining.
	 */
	readonly events: Events<{ changed: undefined; drain: string }>;
}

/**
 * What asks for a slot: conversation `id`'s agent, of `task`, by the
 * agent's id, which a worker must hold the key of. An automatic one, which
 * splates started on its own, waits while starts are paused; one the person
 * started goes on any worker up.
 */
export interface SlotAsk {
	id: string;
	task: string | null;
	agent: string;
	automatic: boolean;
}

/** A slot on a worker, and how to start an agent there. */
export interface Placement extends Grant {
	launch: Launch;
}

/** A slot on a worker an agent already runs on, and how to take it back. */
export interface Hold extends Grant {
	/**
	 * Takes back the process `handle` names on the worker, as
	 * `Launcher.resume` does, once that worker joins.
	 */
	resume: Launcher["resume"];
}

/** The splates projects on this machine, as `Projects` lists them. */
export interface ProjectRoster {
	/** Each project, flagged `gone` when its repository is no longer there. */
	list(): Promise<(ProjectRef & { gone: boolean })[]>;
	/** What the project at `from` may do in the one at `to`. */
	reach(from: string, to: string): Promise<Reach>;
}

/** A splates project a prompt can name as `#slug`. */
export interface ProjectRef {
	slug: string;
	/** Its main tree's root. */
	root: string;
}

/**
 * `changed`, `ended` (a turn ended, however it did, or the agent failed to
 * start) and `removed` each carry a conversation's id.
 */
export type ConversationsEvents = {
	settings: undefined;
	changed: string;
	ended: string;
	removed: string;
};
