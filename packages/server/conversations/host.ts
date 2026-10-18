import type { Events } from "webappwiz/events";
import type { IdProvider } from "webappwiz/id";
import type { Fs, Lock } from "webappwiz/system";
import type { Timer, WallClock } from "webappwiz/time";
import type { Agent, Launch, Launcher } from "../agent-process";
import type { ArtifactRoom } from "../artifact-room";
import type { ArtifactLimits } from "../artifacts";
import type { Reach } from "../projects";
import type { Grant } from "../scheduler";
import type { SessionServers } from "../shared-browser";
import type { Watch } from "../watch";
import type { WorkerMachine } from "../workers";
import type { ConversationLog } from "./log";
import type { ConversationState, QueueSpot } from "./state";

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
	/**
	 * The worker it was placed on, when that is not this machine's own: where
	 * its git and its background commands' output are read. Null on this
	 * machine's worker.
	 */
	readonly placedOn: WorkerMachine | null;
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
}

export type ConversationEvents = { changed: undefined; chosen: string };

/** What every conversation in a repo is made with. */
export interface ConversationDeps {
	fs: Fs;
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
	 * Where each agent another agent started waits for a slot on a worker
	 * before it starts, and starts there; one the person started, or every
	 * one with none, starts at once on `launcher`.
	 */
	slots?: ConversationSlots;
	/** Where the agent runs, which its background commands' output is read from. */
	machine: WorkerMachine;
	/**
	 * Where an agent placed on a worker other than this machine's starts;
	 * without it, it starts where it was asked to.
	 */
	checkouts?: PlacedCheckouts;
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
}

/** A project's way into the machine's queue for worker slots (`Scheduler`). */
export interface ConversationSlots {
	/**
	 * A slot for the agent of conversation `id`, once its turn comes;
	 * aborting `signal` takes it out of the queue, rejecting.
	 */
	take(
		request: { id: string; task: string | null },
		signal: AbortSignal,
	): Promise<Placement>;
	/** Counts an agent already running on `worker` against its slots. */
	hold(request: { id: string; task: string | null }, worker: string): Grant;
	/** Where the agent of conversation `id` waits; null for one not waiting. */
	spot(id: string): QueueSpot | null;
	readonly events: Events<{ changed: undefined }>;
}

/** A slot on a worker, and how to start an agent there. */
export interface Placement extends Grant {
	launch: Launch;
	/** The worker, when it is not this machine's own; null for that one. */
	machine: WorkerMachine | null;
}

/**
 * The checkouts an agent placed on a remote worker works in: its task's
 * clone there, or the project's own clone, from which it clones the task.
 */
export interface PlacedCheckouts {
	/**
	 * Where an agent of `task`, or of none, starts on worker `worker`, which
	 * `machine` reaches, readying the project there first when it must.
	 */
	where(
		worker: string,
		machine: WorkerMachine,
		task: string | null,
	): Promise<string>;
	/** Whether `task`'s checkout is a clone on a worker, not on this machine. */
	elsewhere(task: string): Promise<boolean>;
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
