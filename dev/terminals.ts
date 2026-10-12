import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { TerminalSession } from "./terminal-session";

export type TerminalsEvents = { changed: undefined };

/**
 * The page's shells, one per conversation, each started in that
 * conversation's tree the first time its pane opens, and kept running while
 * the pane is shut or another conversation is up, until the browser tab
 * closes. Whether the pane is open is one setting for every conversation, the
 * way an editor's side panel stays put as you switch files, and outlives a
 * reload in `storage`. The main tree's own terminals, opened from New, are
 * more shells, kept under `terminal/<n>` until closed. It changes whenever
 * one of its shells does.
 */
export class Terminals implements Eventful<TerminalsEvents>, Resource {
	private readonly dispatcher = new Dispatcher<TerminalsEvents>();
	readonly events = this.dispatcher.events;

	/** Whether the pane beside a conversation shows its terminal. */
	open: boolean;

	/**
	 * The conversation whose pane was just shown, whose terminal takes the
	 * keyboard as it draws. Moving to another conversation leaves the keyboard
	 * in that one's composer, where it lands.
	 */
	focusing: string | null = null;

	/** The main tree's own terminals' keys, oldest first. */
	mains: string[] = [];

	private readonly sessions = new Map<string, TerminalSession>();

	constructor(private readonly storage: Storage) {
		this.open = this.stored() === "open";
	}

	/**
	 * The shell for `conversation`, made now in `task`'s worktree (or the main
	 * tree for null) if it has none; it connects once it is first shown.
	 */
	sessionFor(conversation: string, task: string | null): TerminalSession {
		if (this.focusing !== conversation) {
			this.focusing = null;
		}
		let session = this.sessions.get(conversation);
		if (session === undefined) {
			session = new TerminalSession(task);
			session.events.on("changed", () => this.dispatcher.dispatch("changed"));
			this.sessions.set(conversation, session);
		}
		return session;
	}

	/** Shows the pane beside `conversation`, or hides it. */
	toggle(conversation: string): void {
		this.set(!this.open, conversation);
	}

	/** Shows the pane beside `conversation`, its terminal taking the keyboard. */
	show(conversation: string): void {
		this.set(true, conversation);
	}

	private set(open: boolean, conversation: string): void {
		this.open = open;
		this.focusing = open ? conversation : null;
		try {
			this.storage.setItem(KEY, this.open ? "open" : "hidden");
		} catch {
			// Storage refused, full or off: the pane stays as set until a reload.
		}
		this.dispatcher.dispatch("changed");
	}

	/**
	 * Hangs up on `conversation`'s shell; the next one starts in whatever tree
	 * the conversation is in then, which is how an exited shell comes back and
	 * how one follows its agent into a task.
	 */
	restart(conversation: string): void {
		this.sessions.get(conversation)?.dispose();
		this.sessions.delete(conversation);
		this.dispatcher.dispatch("changed");
	}

	/**
	 * Whether `conversation` has a shell that has not exited, which archiving
	 * would hang up on, along with whatever runs in it.
	 */
	running(conversation: string): boolean {
		const status = this.sessions.get(conversation)?.status;
		return status === "connecting" || status === "open";
	}

	/**
	 * Starts another shell in the main tree, numbered one past the highest
	 * open, and returns its key.
	 */
	another(): string {
		const next = Math.max(0, ...this.mains.map(numberOf)) + 1;
		const key = `${MAIN}/${next}`;
		this.keep(key);
		return key;
	}

	/**
	 * Lists `key` among the main tree's terminals, as one opened by its address
	 * is after a reload; its shell starts once its page shows.
	 */
	keep(key: string): void {
		if (!this.mains.includes(key)) {
			this.mains = [...this.mains, key];
			this.dispatcher.dispatch("changed");
		}
	}

	/**
	 * Hangs up on `conversation`'s shell, if it has one, as it is archived or
	 * a main-tree terminal is closed.
	 */
	close(conversation: string): void {
		this.mains = this.mains.filter((each) => each !== conversation);
		if (this.sessions.has(conversation)) {
			this.restart(conversation);
		}
	}

	private stored(): string | null {
		try {
			return this.storage.getItem(KEY);
		} catch {
			return null;
		}
	}

	dispose(): void {
		for (const session of this.sessions.values()) {
			session.dispose();
		}
		this.sessions.clear();
		this.dispatcher.dispose();
	}
}

/**
 * What the main tree's own terminals' keys start with, before `/<n>`, which
 * no conversation id does.
 */
export const MAIN = "terminal";

/** Whether `key` is one of the main tree's own terminals. */
export function isMain(key: string): boolean {
	return key.startsWith(`${MAIN}/`);
}

/** The number a main-tree terminal goes by, from its key. */
export function numberOf(key: string): number {
	return Number(key.slice(MAIN.length + 1)) || 0;
}

/** Where the pane's state is kept, beside the drafts' `arbor.draft.` keys. */
const KEY = "arbor.terminal";
