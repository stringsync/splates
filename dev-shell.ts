import type { AsyncResource, Resource } from "webappwiz/disposable";
import type { ProcessEntry } from "webappwiz/system";
import { Duration, type Timer } from "webappwiz/time";
import { z } from "zod";
import type { ProcessHandle } from "./agent-process";
import { json } from "./dev-http";
import type { Connection } from "./dev-sockets";
import { heldBy } from "./held";
import type { RemotePty } from "./remote-pty";
import type { RemotePtyOptions } from "./remote-worker";

/** Bigger than any screen, and small enough that a typo cannot hurt. */
export const MAX_SIZE = 1000;

/**
 * How long a keyed shell stays once its page's socket goes, for the page to
 * come back to it: through a reload, or a restart of `arbor dev`.
 */
export const TERMINAL_GRACE = Duration.mins(2);

/**
 * What a page says to its terminal that is not typing: a resize, asking
 * what job the shell runs in front, as it does before closing it, or that
 * it is closing it for good, so the shell ends now rather than after
 * `TERMINAL_GRACE`.
 */
const TerminalMessage = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("resize"),
		cols: z.number().int().min(1).max(MAX_SIZE),
		rows: z.number().int().min(1).max(MAX_SIZE),
	}),
	z.object({ type: z.literal("front") }),
	z.object({ type: z.literal("close") }),
]);

/** The shells a terminal opens, as a worker runs them. */
export type TerminalShell = RemotePty;

/** What a terminal needs of the worker it runs on. */
export interface ShellHost {
	pty(options: RemotePtyOptions): TerminalShell;
	/** Takes back a shell the worker kept through a restart; see `RemoteWorker.resumePty`. */
	resumePty(handle: ProcessHandle): TerminalShell;
	processes(): Promise<ProcessEntry[]>;
}

/** A shell handed to the next run of `arbor dev`, as `coordinator.json` keeps it. */
export interface KeptShell {
	key: string;
	handle: ProcessHandle;
}

/**
 * One shell the server runs for a page's terminal, by its key: the page's
 * socket shows it, and may go and come back, through a reload or a restart
 * of `arbor dev`, the worker redrawing the screen for the one that comes
 * back. One with no key ends with its socket; one with a key stays
 * `TERMINAL_GRACE` after it, or until the page says it is closing it.
 */
export class Shell implements AsyncResource {
	private socket: Bun.ServerWebSocket<Connection> | null = null;
	private grace: Resource | null = null;
	private ended = false;

	constructor(
		readonly key: string | null,
		readonly pty: TerminalShell,
		/** The worker the shell runs on, where its job in front is read from. */
		private readonly worker: ShellHost,
		private readonly timer: Timer,
		/** Hears that the shell is gone: exited, closed, or let go. */
		private readonly gone: (shell: Shell) => void,
	) {
		pty.events.on("data", (bytes) => this.socket?.sendBinary(bytes));
		pty.events.on("exit", (code) => {
			this.ended = true;
			this.grace?.dispose();
			this.socket?.send(JSON.stringify({ type: "exit", code }));
			this.socket?.close();
			this.gone(this);
		});
	}

	/** What the next run takes the shell back by, once it has a key. */
	get kept(): KeptShell | null {
		return this.key === null || this.ended
			? null
			: { key: this.key, handle: this.pty.handle };
	}

	/**
	 * Shows the shell on `socket`, in place of any before it: one come back
	 * to a shell has the worker redraw its screen first.
	 */
	attach(socket: Bun.ServerWebSocket<Connection>, back: boolean): void {
		this.grace?.dispose();
		this.grace = null;
		this.socket?.close();
		this.socket = socket;
		if (back) {
			this.pty.describe();
		}
	}

	/** Keeps the shell `TERMINAL_GRACE` for a page to come back to it. */
	wait(): void {
		this.grace?.dispose();
		this.grace = this.timer.setTimeout(
			() => void this.disposeAsync(),
			TERMINAL_GRACE,
		);
	}

	/** The page's `socket` went: keyed, the shell waits for it to come back. */
	detach(socket: Bun.ServerWebSocket<Connection>): void {
		if (this.socket !== socket) {
			return;
		}
		this.socket = null;
		if (this.key === null) {
			void this.disposeAsync();
		} else {
			this.wait();
		}
	}

	message(
		socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		if (this.socket !== socket) {
			return;
		}
		if (typeof message !== "string") {
			this.pty.write(message);
			return;
		}
		const parsed = TerminalMessage.safeParse(json(message));
		if (!parsed.success) {
			return;
		}
		if (parsed.data.type === "resize") {
			this.pty.resize(parsed.data.cols, parsed.data.rows);
		} else if (parsed.data.type === "front") {
			void this.front(socket);
		} else {
			void this.disposeAsync();
		}
	}

	/** Tells the page what the shell runs in front, or null at its prompt. */
	private async front(socket: Bun.ServerWebSocket<Connection>): Promise<void> {
		const { pid } = this.pty;
		const [held] = heldBy(await this.worker.processes(), {
			shells: pid === null ? [] : [pid],
			agents: [],
		});
		socket.send(
			JSON.stringify({ type: "front", command: held?.command ?? null }),
		);
	}

	/** Lets go of the shell for the next run to take back, without ending it. */
	release(): void {
		this.grace?.dispose();
		this.grace = null;
		this.socket?.close();
		this.socket = null;
		this.gone(this);
	}

	/** Hangs up, as closing a terminal window does. */
	async disposeAsync(): Promise<void> {
		this.grace?.dispose();
		this.grace = null;
		if (!this.ended) {
			this.ended = true;
			this.gone(this);
		}
		this.socket?.close();
		this.socket = null;
		await this.pty.disposeAsync();
	}
}
