import type { AsyncResource, Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import {
	type Clock,
	Duration,
	SystemClock,
	SystemTimer,
	type Timer,
} from "webappwiz/time";
import { RUNNING } from "./release";
import { WorkerCallHost } from "./worker-call-host";
import type { WorkerChannel } from "./worker-channel";
import { LocalWorkerMachine } from "./worker-machine";
import { WorkerProcessHost } from "./worker-process-host";
import { WorkerPtyHost } from "./worker-pty-host";
import { WorkerSession, type WorkerSessionOptions } from "./worker-session";
import type { WorkerSocket } from "./worker-socket";

/** How a worker reaches its coordinator, dialed afresh after each drop. */
export interface WorkerDialer {
	/** Where it dials, for the log. */
	readonly where: string;
	dial(): Promise<WorkerSocket>;
}

/** The channels a worker serves, which it says it can in its hello. */
export const WORKER_CAPABILITIES = ["process", "pty", "calls"];

/** Who a `WorkerDaemon` is and what it runs on. */
export interface WorkerDaemonOptions {
	/** Stays the same across restarts, so the coordinator resumes its session. */
	id: string;
	slots: number;
	ps: Ps;
	fs: Fs;
	log: Logger;
	/** The shortest and longest wait between dials. */
	backoff?: { min: Duration; max: Duration };
	/** Paces the session, as `WorkerSession` takes it. */
	session?: Omit<WorkerSessionOptions, "timer" | "clock" | "capabilities">;
	timer?: Timer;
	clock?: Clock;
}

/**
 * `arbor worker run`: a worker that dials out to its coordinator and keeps
 * dialing, waiting longer after each failure, and runs what it is asked to
 * on this machine: processes, PTYs and calls. What it runs outlives a
 * dropped link, since the session replays what the coordinator missed.
 */
export class WorkerDaemon implements AsyncResource {
	readonly session: WorkerSession;
	private readonly hosts = new Set<Resource>();
	private readonly timer: Timer;
	private readonly backoff: { min: Duration; max: Duration };
	private readonly machine: LocalWorkerMachine;
	private waiting: { wake(): void; timeout: Resource } | undefined;
	private stopped = false;

	constructor(
		private readonly dialer: WorkerDialer,
		private readonly opts: WorkerDaemonOptions,
	) {
		this.timer = opts.timer ?? new SystemTimer();
		this.backoff = opts.backoff ?? {
			min: Duration.ms(500),
			max: Duration.secs(10),
		};
		this.machine = new LocalWorkerMachine(opts.ps, opts.fs);
		this.session = new WorkerSession("worker", {
			...opts.session,
			capabilities: WORKER_CAPABILITIES,
			timer: this.timer,
			clock: opts.clock ?? new SystemClock(),
		});
		this.session.events.on("channel", (channel) => this.serve(channel));
	}

	/**
	 * Dials and serves until disposed, or until the coordinator refuses this
	 * worker, resolving with why it stopped.
	 */
	async run(): Promise<{ refused: string } | { stopped: true }> {
		const { log } = this.opts;
		let wait = this.backoff.min;
		// Once per outage, rather than at every dial.
		let said = false;
		while (!this.stopped) {
			const socket = await this.dialer.dial().catch((error: unknown) => {
				if (!said) {
					log.info(
						`cannot reach ${this.dialer.where}, retrying: ${String(error)}`,
					);
					said = true;
				}
				return null;
			});
			if (socket !== null && !this.stopped) {
				const lost = new Promise<string>((resolve) =>
					this.session.events.on("lost", ({ reason }) => resolve(reason), {
						once: true,
					}),
				);
				const negotiated = await this.session.connect(socket, {
					id: this.opts.id,
					info: {
						slots: this.opts.slots,
						platform: this.opts.ps.platform,
						build: RUNNING,
					},
				});
				if (!negotiated.ok && negotiated.refused) {
					return { refused: negotiated.reason };
				}
				if (negotiated.ok) {
					log.info(`worker ${this.opts.id} joined ${this.dialer.where}`);
					wait = this.backoff.min;
					said = false;
					log.info(`lost ${this.dialer.where}: ${await lost}`);
				}
			}
			if (this.stopped) {
				break;
			}
			await this.sleep(wait);
			wait = Duration.min(wait.multiply(2), this.backoff.max);
		}
		return { stopped: true };
	}

	/** Stops dialing and everything this worker runs, and hangs up. */
	async disposeAsync(): Promise<void> {
		this.stopped = true;
		this.waiting?.timeout.dispose();
		this.waiting?.wake();
		for (const host of [...this.hosts]) {
			host.dispose();
		}
		this.session.dispose();
	}

	private serve(channel: WorkerChannel): void {
		const { ps, log } = this.opts;
		let host: Resource;
		try {
			switch (channel.kind) {
				case "process":
					host = new WorkerProcessHost(channel, this.session, ps);
					break;
				case "pty":
					host = new WorkerPtyHost(channel, ps);
					break;
				case "calls":
					host = new WorkerCallHost(channel, this.machine);
					break;
				default:
					log.error(
						`a coordinator opened a ${channel.kind} channel, which this worker does not serve`,
					);
					channel.dispose();
					return;
			}
		} catch (error) {
			channel.send({ type: "failed", reason: String(error) });
			channel.dispose();
			return;
		}
		this.hosts.add(host);
		channel.events.on("close", () => this.hosts.delete(host));
	}

	private sleep(duration: Duration): Promise<void> {
		return new Promise((resolve) => {
			const wake = () => {
				this.waiting = undefined;
				resolve();
			};
			this.waiting = { wake, timeout: this.timer.setTimeout(wake, duration) };
		});
	}
}
