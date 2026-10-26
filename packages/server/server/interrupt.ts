import { aborts } from "webappwiz/abort";
import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { Duration, type Timer } from "webappwiz/time";
import { descendants } from "../workers";

/** Stops the server command on Ctrl-C, even when a child ignores its stop signal. */
export class ServerInterrupt {
	private readonly stopping = new AbortController();
	private readonly forced = new AbortController();
	private deadline: Resource | null = null;
	private forcing = false;

	constructor(
		private readonly ps: Ps,
		private readonly opts: ServerInterruptOptions,
	) {}

	get signal(): AbortSignal {
		return this.stopping.signal;
	}

	interrupt(): void {
		if (this.signal.aborted) {
			void this.force();
			return;
		}
		this.opts.log?.info(
			"Stopping splates server. Press Ctrl+C again to force quit.",
		);
		this.deadline = this.opts.timer.setTimeout(
			() => void this.force(),
			Duration.secs(2),
		);
		this.stopping.abort();
	}

	/** A child that ignores SIGTERM must not hold the command open forever. */
	wait<T>(running: Promise<T>): Promise<T> {
		return aborts.race(this.forced.signal, running);
	}

	dispose(): void {
		this.deadline?.dispose();
		this.deadline = null;
	}

	private async force(): Promise<void> {
		if (this.forcing) {
			return;
		}
		this.forcing = true;
		this.opts.log?.info("Forcing splates server to stop.");
		try {
			// Include the build and worker, and their children, without touching
			// another server running beside this one.
			const under = descendants(await this.ps.processes(), this.ps.pid);
			if (under.length > 0) {
				await this.ps.spawnCapture(["kill", "-KILL", ...under.map(String)]);
			}
		} catch (error) {
			this.opts.log?.error(`Could not stop every child: ${String(error)}`);
		} finally {
			this.forced.abort();
			this.ps.exit(130);
		}
	}
}

interface ServerInterruptOptions {
	timer: Timer;
	log: Logger | null;
}
