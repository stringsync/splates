import type {
	Ps,
	SpawnOptions,
	StartOptions,
	TerminalOptions,
} from "core/system";
import type { MergeAsk } from "./served";

/**
 * The server's process as a `splates merge` in `ask.cwd` saw its own: the
 * working directory and environment are the command's, so the gate runs as
 * it would have there, while the pid stays the server's, whose locks a
 * restart frees. `cd` moves only the view.
 */
export class WorktreePs implements Ps {
	private dir: string;

	constructor(
		private readonly inner: Ps,
		private readonly ask: Pick<MergeAsk, "cwd" | "env">,
	) {
		this.dir = ask.cwd;
	}

	get platform() {
		return this.inner.platform;
	}
	get pid() {
		return this.inner.pid;
	}
	get hostname() {
		return this.inner.hostname;
	}
	get args() {
		return this.inner.args;
	}
	get self() {
		return this.inner.self;
	}
	alive(pid: number) {
		return this.inner.alive(pid);
	}
	spawn(argv: string[], opts?: SpawnOptions) {
		return this.inner.spawn(argv, this.options(opts));
	}
	spawnCapture(argv: string[], opts?: SpawnOptions) {
		return this.inner.spawnCapture(argv, this.options(opts));
	}
	start(argv: string[], opts?: StartOptions) {
		return this.inner.start(argv, this.options(opts));
	}
	startOnTerminal(argv: string[], opts: TerminalOptions) {
		return this.inner.startOnTerminal(argv, this.options(opts));
	}
	processes() {
		return this.inner.processes();
	}
	listening() {
		return this.inner.listening();
	}
	cwd() {
		return this.dir;
	}
	env(name: string) {
		return this.ask.env[name];
	}
	columns() {
		return undefined;
	}
	cd(path: string) {
		this.dir = path;
	}
	exit(code: number): never {
		throw new Error(`a served merge may not exit the server (code ${code})`);
	}
	on(signal: string, handler: (...args: unknown[]) => void) {
		return this.inner.on(signal, handler);
	}
	once(event: "exit", handler: () => void) {
		return this.inner.once(event, handler);
	}

	private options<T extends StartOptions>(opts?: T): T {
		return {
			...opts,
			cwd: opts?.cwd ?? this.dir,
			env: { ...this.ask.env, ...opts?.env },
		} as T;
	}
}
