import type { Events } from "webappwiz/events";
import type { Fs, Lock } from "webappwiz/system";
import type { Timer, WallClock } from "webappwiz/time";
import type { Agent, Launch } from "./agent-process";
import type { ConversationLog } from "./conversation-log";
import type { ConversationState } from "./conversation-state";
import type { Watch } from "./watch";

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
	readonly agent: Agent | null;
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
}

export type ConversationEvents = { changed: undefined };

/** What every conversation in a repo is made with. */
export interface ConversationDeps {
	fs: Fs;
	timer: Timer;
	clock: WallClock;
	launch: Launch;
	/**
	 * Held while an agent's process starts, until it answers `initialize`:
	 * agents launched through `bunx` at once race in its install, and most die.
	 */
	starting: Lock;
	/** Where `arbor dev` answers, for the agent's CLI to tell it things. */
	url: string | null;
	/** What watches the agent's commands; null to leave them be. */
	watch: Watch | null;
	/** The main tree, where a conversation carries on once its worktree is gone. */
	root: string | null;
}
