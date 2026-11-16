import type { AsyncResource } from "core/disposable";
import type { ProcessEntry } from "core/system";
import { z } from "zod";
import type { ProcessHandle } from "../agents";
import type { Connection } from "../server/shared";
import { json } from "../server/shared";
import type { RemotePtyOptions } from "../workers";
import { heldBy } from "./held";
import type { RemotePty } from "./remote-pty";

/** Bigger than any screen, and small enough that a typo cannot hurt. */
export const MAX_SIZE = 1000;

/**
 * What a page says to its terminal that is not typing: a resize, asking
 * what job the shell runs in front, as it does before closing it, or that
 * it is closing it for good, which is the only thing but the shell's own
 * exit that ends a keyed shell.
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
	/** Takes back a shell the worker kept through a restart; see `ConnectedWorker.resumePty`. */
	resumePty(handle: ProcessHandle): TerminalShell;
	processes(): Promise<ProcessEntry[]>;
}

/** A shell handed to the next run of `splates server`, as `coordinator.json` keeps it. */
export interface KeptShell {
	key: string;
	handle: ProcessHandle;
	/** The name a page gave it, if any. */
	name?: string;
}

/**
 * One shell the server runs for a terminal, by its key, shown on any number
 * of pages' sockets at once: what it writes goes to every one, and typing
 * from any reaches it. A socket may go and come back, through a reload or a
 * restart of `splates server`. One with no key ends with its socket; one with
 * a key stays until a page says it is closing it or the shell exits, however
 * long its pages are away (a sleeping laptop, a backgrounded phone tab).
 */
export class Shell implements AsyncResource {
	private readonly sockets = new Set<Bun.ServerWebSocket<Connection>>();
	// The shell takes the size of the screen that last typed or resized.
	/** The size each socket's screen last asked for. */
	private readonly sizes = new Map<
		Bun.ServerWebSocket<Connection>,
		{ cols: number; rows: number }
	>();
	/** The socket whose screen the shell's size follows: the last to type or resize. */
	private active: Bun.ServerWebSocket<Connection> | null = null;
	private ended = false;

	/** What a page named it, shared by every page that shows it. */
	name: string | null = null;

	// vet-ignore objects-over-callbacks: the one owner of a shell hears it go, to drop it from its table
	constructor(
		readonly key: string | null,
		readonly pty: TerminalShell,
		/** The worker the shell runs on, where its job in front is read from. */
		private readonly worker: ShellHost,
		/** Hears that the shell is gone: exited, closed, or let go. */
		private readonly gone: (shell: Shell) => void,
	) {
		pty.events.on("data", (bytes) => {
			for (const socket of this.sockets) {
				socket.sendBinary(bytes);
			}
		});
		pty.events.on("exit", (code) => {
			this.ended = true;
			for (const socket of this.sockets) {
				socket.send(JSON.stringify({ type: "exit", code }));
				socket.close();
			}
			this.sockets.clear();
			this.gone(this);
		});
	}

	/** What the next run takes the shell back by, once it has a key. */
	get kept(): KeptShell | null {
		return this.key === null || this.ended
			? null
			: {
					key: this.key,
					handle: this.pty.handle,
					...(this.name === null ? {} : { name: this.name }),
				};
	}

	/** Shows the shell on `socket` as well as on any before it; `back` has the worker redraw its screen. */
	attach(socket: Bun.ServerWebSocket<Connection>, back: boolean): void {
		this.sockets.add(socket);
		if (back) {
			// Every socket is told to clear first, so each draws the same screen.
			for (const each of this.sockets) {
				each.send(JSON.stringify({ type: "redraw" }));
			}
			this.pty.describe();
		}
	}

	/** Takes `socket` off the shell, which a keyed one outlives. */
	detach(socket: Bun.ServerWebSocket<Connection>): void {
		if (!this.sockets.delete(socket)) {
			return;
		}
		this.sizes.delete(socket);
		if (this.active === socket) {
			this.active = null;
		}
		if (this.key === null && this.sockets.size === 0) {
			void this.disposeAsync();
		}
	}

	/** Hears from `socket` that its screen has `cols` by `rows`. */
	private resized(
		socket: Bun.ServerWebSocket<Connection>,
		cols: number,
		rows: number,
	): void {
		this.sizes.set(socket, { cols, rows });
		this.active = socket;
		this.pty.resize(cols, rows);
	}

	message(
		socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		if (!this.sockets.has(socket)) {
			return;
		}
		if (typeof message !== "string") {
			// Typing from a screen the shell is not sized to takes its size.
			const size = this.sizes.get(socket);
			if (this.active !== socket && size !== undefined) {
				this.resized(socket, size.cols, size.rows);
			}
			this.pty.write(message);
			return;
		}
		const parsed = TerminalMessage.safeParse(json(message));
		if (!parsed.success) {
			return;
		}
		if (parsed.data.type === "resize") {
			this.resized(socket, parsed.data.cols, parsed.data.rows);
		} else if (parsed.data.type === "front") {
			void this.front(socket);
		} else {
			// The other pages showing it are told it ended, so none starts another.
			for (const each of this.sockets) {
				if (each !== socket) {
					each.send(JSON.stringify({ type: "exit", code: 0 }));
				}
			}
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
		for (const socket of this.sockets) {
			socket.close();
		}
		this.sockets.clear();
		this.gone(this);
	}

	/** Hangs up, as closing a terminal window does. */
	// vet-ignore resources-are-disposable: the sockets are the server's, hung up on here as the shell ends
	async disposeAsync(): Promise<void> {
		if (!this.ended) {
			this.ended = true;
			this.gone(this);
		}
		for (const socket of this.sockets) {
			socket.close();
		}
		this.sockets.clear();
		await this.pty.disposeAsync();
	}
}
