import type { Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";
import { Duration, SystemTimer, type Timer } from "core/time";
import type { SharedTerminals } from "./shared-terminals";
import type { TerminalSession } from "./terminal-session";

/** How often each shell is asked what it runs in front. */
const FRONT_POLL = Duration.secs(2);

export type TerminalsEvents = {
	changed: undefined;
	/** A shell exited, by its key, and its session is gone. */
	exited: string;
};

/**
 * The page's shells: one per conversation, plus the main tree's own
 * terminals. Ask `sessionFor` for a conversation's shell, `nameOf` for what a
 * terminal is called, and listen for `changed`.
 */
// A shell starts in its conversation's tree the first time its pane opens and
// keeps running on the server until it is closed, whichever page is open: given
// `shared`, the terminals every device has up, with their names, show on this
// page too, and a close on one closes it on all. Which one the pane shows
// outlives a reload in `storage`, as do names given while the server has no
// shell by that key. Main-tree terminals, opened from New, live under
// `terminal/<n>` until closed, and a shell that exits is closed with it.
export class Terminals implements Eventful<TerminalsEvents>, Resource {
	private readonly dispatcher = new Dispatcher<TerminalsEvents>();
	readonly events = this.dispatcher.events;

	/** The conversation whose terminal the pane beside it shows, or null. */
	open: string | null;

	/**
	 * The conversation whose pane was just shown, whose terminal takes the
	 * keyboard as it draws. Moving to another conversation leaves the keyboard
	 * in that one's composer, where it lands.
	 */
	focusing: string | null = null;

	/** The main tree's own terminals' keys, oldest first. */
	mains: string[] = [];

	private readonly sessions = new Map<string, TerminalSession>();

	/** The names terminals were given by hand, by key; they win over every default. */
	names: Record<string, string>;

	/** The job each shell runs in front now, by key, as `sleep 5`; absent at a prompt. */
	private fronts: Record<string, string> = {};

	private polling: ReturnType<Timer["setTimeout"]> | null = null;

	private readonly timer: Timer;

	/** The terminals the server keeps for every page, or null for this page's own alone. */
	private readonly shared: SharedTerminals | null;

	/** The keys `shared` has said are up, so one it stops saying is known closed elsewhere. */
	private remote = new Set<string>();

	/** Its shells leave to the page each key `toggles` says shows or hides one. */
	// vet-ignore objects-over-callbacks: a test of one key, handed to each shell
	constructor(
		private readonly storage: Storage,
		// vet-ignore objects-over-callbacks: a test of one key, handed to each shell
		private readonly toggles: (event: KeyboardEvent) => boolean,
		{
			timer = new SystemTimer(),
			shared = null,
		}: { timer?: Timer; shared?: SharedTerminals | null } = {},
	) {
		this.timer = timer;
		this.shared = shared;
		shared?.events.on("changed", () => this.synced());
		this.open = this.stored();
		this.names = this.storedNames();
	}

	/**
	 * What terminal `key` is called: the name it was given, or else the
	 * command it runs in front, or else a main tree's by its number and a
	 * conversation's plain "Terminal".
	 */
	nameOf(key: string): string {
		const listed = this.shared?.find(key);
		return (
			(listed === undefined ? this.names[key] : listed.name) ??
			this.fronts[key] ??
			(isMain(key) ? `Terminal ${numberOf(key)}` : "Terminal")
		);
	}

	/** Names terminal `key`; a blank name goes back to the one it goes by. */
	rename(key: string, name: string): void {
		const { [key]: _, ...rest } = this.names;
		this.names = name.trim() === "" ? rest : { ...rest, [key]: name.trim() };
		try {
			this.storage.setItem(NAMES, JSON.stringify(this.names));
		} catch {
			// Storage refused, full or off: the name holds until a reload.
		}
		void this.shared?.rename(key, name);
		this.dispatcher.dispatch("changed");
	}

	/**
	 * Takes in what the server says is up: terminals another page opened show
	 * here, and one it no longer says, closed elsewhere, goes.
	 */
	private synced(): void {
		if (this.shared === null || !this.shared.loaded) {
			return;
		}
		const now = new Set(this.shared.list.map((each) => each.key));
		for (const key of this.remote) {
			if (!now.has(key)) {
				this.gone(key);
			}
		}
		this.remote = now;
		const added = [...now].filter(
			(key) => isMain(key) && !this.mains.includes(key),
		);
		if (added.length > 0) {
			this.mains = [...this.mains, ...added].sort(
				(left, right) => numberOf(left) - numberOf(right),
			);
		}
		this.dispatcher.dispatch("changed");
	}

	/** Lets go of terminal `key`, which another page closed, leaving the shell as it is. */
	private gone(key: string): void {
		const session = this.sessions.get(key);
		this.sessions.delete(key);
		if (this.open === key) {
			this.hide();
		}
		this.forget(key);
		this.mains = this.mains.filter((each) => each !== key);
		this.dispatcher.dispatch("exited", key);
		session?.detach();
	}

	/**
	 * The shell for `conversation`, made now in `task`'s worktree (or the main
	 * tree for null) if it has none; it connects once it is first shown.
	 * `project` is the slug of the project they are in, the page's for null.
	 */
	sessionFor(
		conversation: string,
		task: string | null,
		project: string | null = null,
	): TerminalSession | null {
		// xterm is a script chunk of its own, fetched the first time a shell is
		// asked for. None until it arrives, which tells whoever drew the
		// change to draw again.
		const Session = this.loaded;
		if (Session === null) {
			void this.load();
			return null;
		}
		if (this.focusing !== conversation) {
			this.focusing = null;
		}
		let session = this.sessions.get(conversation);
		if (session === undefined) {
			const made = new Session(conversation, task, this.toggles, {
				timer: this.timer,
				project,
			});
			made.events.on("changed", () => {
				if (made.status === "exited") {
					this.exited(conversation);
				} else {
					this.dispatcher.dispatch("changed");
				}
			});
			session = made;
			this.sessions.set(conversation, session);
			this.poll();
		}
		return session;
	}

	/** Starts listening for the terminals other pages open, if it is given any to hear. */
	start(): void {
		this.shared?.start();
	}

	/** Asks each shell what it runs in front, now and again every few seconds. */
	private poll(): void {
		if (this.polling !== null) {
			return;
		}
		this.polling = this.timer.setTimeout(() => {
			this.polling = null;
			void this.refreshFronts();
		}, FRONT_POLL);
	}

	private async refreshFronts(): Promise<void> {
		const entries = [...this.sessions.entries()];
		const asked = await Promise.all(
			entries.map(
				async ([key, session]) => [key, await session.front()] as const,
			),
		);
		const next: Record<string, string> = {};
		for (const [key, command] of asked) {
			if (command !== null && this.sessions.has(key)) {
				next[key] = command;
			}
		}
		const same =
			JSON.stringify(Object.entries(next).sort()) ===
			JSON.stringify(Object.entries(this.fronts).sort());
		this.fronts = next;
		if (!same) {
			this.dispatcher.dispatch("changed");
		}
		if (this.sessions.size > 0) {
			this.poll();
		}
	}

	/** The shell class once its chunk is in, which `sessionFor` needs. */
	private loaded: typeof TerminalSession | null = null;

	private loading: Promise<void> | null = null;

	private load(): Promise<void> {
		this.loading ??= import("./terminal-session").then((module) => {
			this.loaded = module.TerminalSession;
			this.dispatcher.dispatch("changed");
		});
		return this.loading;
	}

	/** Types `code` into `conversation`'s shell, making it first if need be. */
	async run(
		conversation: string,
		task: string | null,
		code: string,
	): Promise<void> {
		await this.load();
		this.sessionFor(conversation, task)?.run(code);
	}

	/** Shows the pane beside `conversation`, or hides it. */
	toggle(conversation: string): void {
		this.set(this.open === conversation ? null : conversation);
	}

	/** Shows the pane beside `conversation`, its terminal taking the keyboard. */
	show(conversation: string): void {
		this.set(conversation);
	}

	private set(open: string | null): void {
		this.open = open;
		this.focusing = open;
		try {
			if (open === null) {
				this.storage.removeItem(KEY);
			} else {
				this.storage.setItem(KEY, open);
			}
		} catch {
			// Storage refused, full or off: the pane stays as set until a reload.
		}
		this.dispatcher.dispatch("changed");
	}

	/** Hides the pane, for the conversation whose shell just exited. */
	hide(): void {
		this.set(null);
	}

	/** Hangs up on `conversation`'s shell so a fresh one starts in its current tree. */
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
		return (
			status === "connecting" ||
			status === "open" ||
			(this.sessions.get(conversation) === undefined &&
				this.remote.has(conversation))
		);
	}

	/**
	 * The job terminal `key`'s shell runs in front, or null at its prompt or
	 * with no shell: what closing it would stop.
	 */
	front(key: string): Promise<string | null> {
		return this.sessions.get(key)?.front() ?? Promise.resolve(null);
	}

	/** The conversations whose shells are up, which the sidebar nests under each. */
	up(): string[] {
		return [...new Set([...this.sessions.keys(), ...this.remote])].filter(
			(key) => !isMain(key) && this.running(key),
		);
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
		if (this.open === conversation) {
			this.hide();
		}
		this.forget(conversation);
		this.mains = this.mains.filter((each) => each !== conversation);
		if (this.sessions.has(conversation)) {
			this.restart(conversation);
		}
	}

	/**
	 * Drops the shell `key` ran, which just exited, and its row if it is one of
	 * the main tree's. Whoever shows it hears first, so a pane hides before the
	 * conversation it showed would start another.
	 */
	private exited(key: string): void {
		const session = this.sessions.get(key);
		this.sessions.delete(key);
		if (this.open === key) {
			this.hide();
		}
		this.forget(key);
		this.mains = this.mains.filter((each) => each !== key);
		this.dispatcher.dispatch("exited", key);
		this.dispatcher.dispatch("changed");
		session?.dispose();
	}

	/** Drops a main-tree terminal's name as it goes, since its number comes back. */
	private forget(key: string): void {
		if (isMain(key) && key in this.names) {
			this.rename(key, "");
		}
	}

	private storedNames(): Record<string, string> {
		try {
			const names: unknown = JSON.parse(this.storage.getItem(NAMES) ?? "{}");
			return typeof names === "object" && names !== null
				? (names as Record<string, string>)
				: {};
		} catch {
			return {};
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
		this.polling?.dispose();
		this.polling = null;
		// Left running for whichever page shows them next, as on a switch of project.
		for (const session of this.sessions.values()) {
			session.detach();
		}
		this.sessions.clear();
		this.shared?.dispose();
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

/**
 * Where the conversation the pane is open beside is kept, beside the drafts'
 * `splates.draft.` keys. Not `splates.terminal`, which held one open or
 * hidden for every conversation.
 */
const KEY = "splates.terminal.beside";

/** Where the names terminals were given are kept. */
const NAMES = "splates.terminal.names";
