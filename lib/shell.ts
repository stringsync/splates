import type {
	Ps,
	SpawnCaptureResult,
	SpawnOptions,
	SpawnResult,
} from "@webappwiz/sys";

/** Spawn options for a shell command. `cwd` is the worktree it runs against. */
export type ShellOptions = SpawnOptions & { cwd: string };

/**
 * Runs the commands a repo configures (`testCommand`, `postCreate`) as
 * shell strings rather than argv, since that is how a repo writes them.
 */
export class Shell {
	// This is the whole of what `graft` and `create` are allowed to do to the
	// process. Handing them a `Ps` instead would hand them `exit` and `cd` too.
	constructor(private readonly ps: Ps) {}

	/** Captures output, for commands whose failure has to be reported back. */
	run(command: string, options: ShellOptions): Promise<SpawnCaptureResult> {
		return this.ps.spawnCapture(["sh", "-c", command], options);
	}

	/** Inherits stdio, for commands the agent should watch as they run. */
	stream(command: string, options: ShellOptions): Promise<SpawnResult> {
		return this.ps.spawn(["sh", "-c", command], options);
	}
}
