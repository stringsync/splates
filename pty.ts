import type { AsyncResource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";

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
}

/**
 * A program on a pseudo-terminal of its own, the way a terminal window runs a
 * shell: whatever it writes arrives as `data`, and `write` is typing at it.
 * POSIX only, since `Bun.Terminal` is.
 */
// TODO: webappwiz/system once `Ps` can start a child on a terminal
export class Pty implements AsyncResource, Eventful<PtyEvents> {
	private readonly dispatcher = new Dispatcher<PtyEvents>();
	readonly events = this.dispatcher.events;
	private readonly terminal: Bun.Terminal;
	private readonly child: Bun.Subprocess;

	constructor({ argv, cwd, cols, rows, env = {} }: PtyOptions) {
		this.terminal = new Bun.Terminal({
			cols,
			rows,
			data: (_, bytes) => this.dispatcher.dispatch("data", bytes),
		});
		// In a session of its own, so the terminal can be its controlling one:
		// see CLAIM.
		this.child = Bun.spawn([process.execPath, "-e", CLAIM, "--", ...argv], {
			terminal: this.terminal,
			cwd,
			env: { ...process.env, TERM: "xterm-256color", ...env },
			detached: true,
		});
		// The exit code, not the terminal's own `exit`, which only says the
		// stream closed and on Linux may never fire at all (Bun issue 40289).
		void this.child.exited.then((code) =>
			this.dispatcher.dispatch("exit", code),
		);
	}

	/** Types `data` at the program, keys and pastes alike. */
	write(data: string | Uint8Array): void {
		if (!this.terminal.closed) {
			this.terminal.write(data);
		}
	}

	/** What a window resize does: the program hears of it as SIGWINCH. */
	resize(cols: number, rows: number): void {
		if (!this.terminal.closed) {
			this.terminal.resize(cols, rows);
		}
	}

	/**
	 * Hangs up, as closing a terminal window does: the shell passes it on to
	 * its jobs, background ones included.
	 */
	async disposeAsync(): Promise<void> {
		if (this.child.exitCode === null && this.child.signalCode === null) {
			this.child.kill("SIGHUP");
		}
		this.terminal.close();
		await this.child.exited;
		this.dispatcher.dispose();
	}
}

/**
 * Run by `bun -e` as the terminal's child, ahead of the program it is handed:
 * makes the terminal its controlling one, then becomes that program. Without
 * it, ^C never interrupts the job in front and a resize never reaches
 * full-screen programs, since `Bun.Terminal` leaves the child with no
 * controlling terminal (Bun issue 33237). Drop it once Bun does this itself.
 */
const CLAIM = `
import { dlopen, FFIType, ptr } from "bun:ffi";
const darwin = process.platform === "darwin";
const libc = dlopen(darwin ? "libc.dylib" : "libc.so.6", {
	ioctl: { args: [FFIType.i32, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
	execvp: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const TIOCSCTTY = darwin ? 0x20007461 : 0x540e;
if (libc.symbols.ioctl(0, TIOCSCTTY, 0) !== 0) {
	console.error("arbor: ^C and resizes will not reach programs in this terminal");
}
const argv = process.argv.slice(1);
const strings = argv.map((arg) => Buffer.from(arg + "\\0"));
const pointers = new BigUint64Array(argv.length + 1);
strings.forEach((each, i) => { pointers[i] = BigInt(ptr(each)); });
libc.symbols.execvp(ptr(strings[0]), ptr(pointers));
console.error("arbor: could not run " + argv[0]);
process.exit(127);
`;
