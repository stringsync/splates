import type { Ps, SpawnCaptureResult, SpawnResult } from "@webappwiz/sys";

export interface ShellOptions {
	cwd: string;
	/** Added to the current environment, not a replacement for it. */
	env?: Record<string, string>;
}

/** Runs the commands a repo configures — `testCommand`, `postCreate`. */
export class Shell {
	constructor(private readonly ps: Ps) {}

	/** Captures output, for commands whose failure has to be reported back. */
	run(command: string, options: ShellOptions): Promise<SpawnCaptureResult> {
		return this.ps.spawnCapture(
			["sh", "-c", command],
			this.spawnOptions(options),
		);
	}

	/** Inherits stdio, for commands the agent should watch as they run. */
	stream(command: string, options: ShellOptions): Promise<SpawnResult> {
		return this.ps.spawn(["sh", "-c", command], this.spawnOptions(options));
	}

	private spawnOptions({ cwd, env }: ShellOptions) {
		return {
			cwd,
			env: { ...(process.env as Record<string, string>), ...env },
		};
	}
}
