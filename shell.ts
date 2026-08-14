import {
	NodePs,
	type Ps,
	type SpawnCaptureResult,
	type SpawnOptions,
	type SpawnResult,
} from "@webappwiz/sys";

/** Spawn options for a shell command. `cwd` is the worktree it runs against. */
export type ShellRunOptions = SpawnOptions & { cwd: string };

/** What a `Shell` spawns through; the real process by default. */
export interface ShellOptions {
	ps?: Ps;
}

/**
 * Runs the commands a repo configures (the lifecycle hooks) as shell strings
 * rather than argv, since that is how a repo writes them.
 */
export class Shell {
	private readonly ps: Ps;

	// This is the whole of what `merge` and `add` are allowed to do to the
	// process. Handing them a `Ps` instead would hand them `exit` and `cd` too.
	constructor(opts: ShellOptions = {}) {
		this.ps = opts.ps ?? new NodePs();
	}

	/** Captures output, for commands whose failure has to be reported back. */
	run(command: string, opts: ShellRunOptions): Promise<SpawnCaptureResult> {
		return this.ps.spawnCapture(["sh", "-c", command], opts);
	}

	/** Inherits stdio, for commands the agent should watch as they run. */
	stream(command: string, opts: ShellRunOptions): Promise<SpawnResult> {
		return this.ps.spawn(["sh", "-c", command], opts);
	}
}
