import { aborts } from "core/abort";
import type { Resource } from "core/disposable";
import type { Logger } from "core/log";
import type { Ps } from "core/system";
import { Duration, type Timer } from "core/time";
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
		this.opts.log.info(
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
		this.opts.log.info("Forcing splates server to stop.");
		try {
			// Include the build and worker, and their children, without touching
			// another server running beside this one.
			const under = descendants(await this.ps.processes(), this.ps.pid);
			if (under.length > 0) {
				await this.ps.spawnCapture(["kill", "-KILL", ...under.map(String)]);
				// SIGKILL lands asynchronously: exit only once they are gone, so the
				// command's caller never sees a child outlive it.
				await this.gone(under);
			}
		} catch (error) {
			this.opts.log.error(`Could not stop every child: ${String(error)}`);
		} finally {
			this.forced.abort();
			this.ps.exit(130);
		}
	}

	/** Waits, up to a second, until none of `pids` is alive. */
	private async gone(pids: number[]): Promise<void> {
		for (let tries = 0; tries < 50; tries++) {
			if (!pids.some((pid) => this.ps.alive(pid))) {
				return;
			}
			await new Promise<void>((resolve) => {
				this.opts.timer.setTimeout(resolve, Duration.ms(20));
			});
		}
		this.opts.log.error(
			`Children still alive after a forced stop: ${pids.filter((pid) => this.ps.alive(pid)).join(" ")}`,
		);
	}
}

interface ServerInterruptOptions {
	timer: Timer;
	log: Logger;
}
