import type { AsyncResource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { NodePs, type Ps, type TerminalChild } from "webappwiz/system";
import { SERVING } from "./supervise";

/** What a shell on a `Pty` says: bytes it wrote, and that it is gone. */
export interface PtyEvents extends Record<string, unknown> {
	data: Uint8Array;
	exit: number;
}

/** Where and how big a `Pty` starts. */
export interface PtyOptions {
	argv: string[];
	cwd: string;
	cols: number;
	rows: number;
	env?: Record<string, string>;
	ps?: Ps;
}

/**
 * A program on a pseudo-terminal of its own, the way a terminal window runs a
 * shell: whatever it writes arrives as `data`, and `write` is typing at it.
 * POSIX only, since `Bun.Terminal` is.
 */
export class Pty implements AsyncResource, Eventful<PtyEvents> {
	private readonly dispatcher = new Dispatcher<PtyEvents>();
	readonly events = this.dispatcher.events;
	private readonly child: TerminalChild;

	constructor({
		argv,
		cwd,
		cols,
		rows,
		env = {},
		ps = new NodePs(),
	}: PtyOptions) {
		const child = ps.startOnTerminal(argv, {
			cols,
			rows,
			cwd,
			env: { TERM: "xterm-256color", ...env },
			// So an `arbor dev` run here supervises itself, as one in any other
			// terminal does, rather than serving as this one's child.
			unset: [SERVING],
		});
		this.child = child;
		void (async () => {
			for await (const bytes of child.output) {
				this.dispatcher.dispatch("data", bytes);
			}
		})();
		void child.exited.then((code) => this.dispatcher.dispatch("exit", code));
	}

	/** The shell's pid, for the job it runs. */
	get pid(): number {
		return this.child.pid;
	}

	/** Types `data` at the program, keys and pastes alike. */
	write(data: string | Uint8Array): void {
		this.child.write(data);
	}

	/** What a window resize does: the program hears of it as SIGWINCH. */
	resize(cols: number, rows: number): void {
		this.child.resize(cols, rows);
	}

	/**
	 * Hangs up, as closing a terminal window does: the shell passes it on to
	 * its jobs, background ones included.
	 */
	async disposeAsync(): Promise<void> {
		this.child.kill("SIGHUP");
		this.child.close();
		await this.child.exited;
		this.dispatcher.dispose();
	}
}
