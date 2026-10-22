import type { AsyncResource, Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import {
	type Clock,
	Duration,
	SystemClock,
	SystemTimer,
	type Timer,
	timeouts,
} from "webappwiz/time";
import { RUNNING } from "../server/shared";
import { splatesHome } from "../models";
import { WorkerCallHost } from "./call-host";
import type { WorkerChannel } from "./channel";
import { challengeNonce, proofHolds } from "./identity";
import { JOBS } from "./job";
import { WorkerJobHost } from "./job-host";
import { hostOf, LocalWorkerMachine } from "./machine";
import { OrphanBound } from "./orphan";
import { WorkerProcessHost } from "./process-host";
import { UPDATE, WorkerProtocol } from "./protocol";
import { WorkerPtyHost } from "./pty-host";
import type { AgentSandbox } from "./sandbox";
import { WorkerSession, type WorkerSessionOptions } from "./session";
import type { WorkerSocket } from "./socket";

/** How a worker reaches its server, dialed afresh after each drop. */
export interface WorkerDialer {
	/** Where it dials, for the log. */
	readonly where: string;
	dial(): Promise<WorkerSocket>;
	/**
	 * The server's public key to check on each dial, and the key to send
	 * once it has proved itself; absent for a server not checked.
	 */
	readonly verify?: { coordinator: string; key: string };
}

/** The channels a worker serves, which it says it can in its hello. */
export const WORKER_CAPABILITIES = ["process", "pty", "calls", JOBS, UPDATE];

/**
 * `splates worker run`: a worker that dials out to its server and keeps
 * dialing, waiting longer after each failure, and runs what it is asked to
 * on this machine: processes, PTYs and calls. What it runs outlives a
 * dropped link, since the session replays what the server missed.
 */
export class WorkerDaemon implements AsyncResource {
	readonly session: WorkerSession;
	private readonly hosts = new Set<Resource>();
	/** The agents and terminals among `hosts`. */
	private running = 0;
	private readonly timer: Timer;
	private readonly backoff: { min: Duration; max: Duration };
	private readonly machine: LocalWorkerMachine;
	private readonly orphanBound: Duration;
	private readonly clock: Clock;
	private orphaned: Resource | undefined;
	/** The bound passed awake: what the server left ends once a redial fails. */
	private due = false;
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
		this.orphanBound = opts.orphanBound ?? Duration.mins(10);
		this.clock = opts.clock ?? new SystemClock();
		this.machine = new LocalWorkerMachine(opts.ps, opts.fs);
		this.session = new WorkerSession("worker", {
			...opts.session,
			capabilities: WORKER_CAPABILITIES,
			timer: this.timer,
			clock: this.clock,
		});
		this.session.events.on("channel", (channel) => this.serve(channel));
		this.session.events.on("connected", () => {
			this.orphaned?.dispose();
			this.due = false;
		});
		this.session.events.on("lost", () => this.orphan());
	}

	/**
	 * Dials and serves until disposed, until the server refuses this
	 * worker, or until it asks this one to restart on its build, resolving
	 * with why it stopped: a refusal names that build too, from a
	 * server that says it.
	 */
	async run(): Promise<WorkerEnded> {
		const { log } = this.opts;
		const host = hostOf(this.opts.ps);
		// Asked once its own have moved off it, so ending what it runs loses
		// nothing a checkpoint does not hold.
		const update = new Promise<string>((resolve) =>
			this.session.events.on("update", ({ build }) => resolve(build), {
				once: true,
			}),
		);
		let wait = this.backoff.min;
		// Once per outage, rather than at every dial.
		let said = false;
		while (!this.stopped) {
			let socket = await this.dialer.dial().catch((error: unknown) => {
				if (!said) {
					log.info(
						`cannot reach ${this.dialer.where}, retrying: ${String(error)}`,
					);
					said = true;
				}
				return null;
			});
			let joined = false;
			const checked =
				socket !== null && this.dialer.verify !== undefined
					? await this.coordinatorProves(socket, this.dialer.verify.coordinator)
					: null;
			if (checked !== null) {
				log.error(
					`refusing the coordinator at ${this.dialer.where}, retrying without sending it this worker's key: ${checked}`,
				);
				socket?.dispose();
				socket = null;
			}
			if (socket !== null && !this.stopped) {
				const lost = new Promise<string>((resolve) =>
					this.session.events.on("lost", ({ reason }) => resolve(reason), {
						once: true,
					}),
				);
				const negotiated = await this.session.connect(socket, {
					id: this.opts.id,
					...(this.dialer.verify === undefined
						? {}
						: { key: this.dialer.verify.key }),
					info: {
						slots: this.opts.slots,
						platform: this.opts.ps.platform,
						...(host === null ? {} : { host }),
						build: RUNNING,
					},
				});
				if (!negotiated.ok && negotiated.refused) {
					return {
						refused: negotiated.reason,
						...(negotiated.update === undefined
							? {}
							: { update: negotiated.update }),
					};
				}
				if (negotiated.ok) {
					joined = true;
					log.info(
						`worker ${this.opts.id} joined ${this.dialer.where}, running ${this.running} agents and terminals`,
					);
					wait = this.backoff.min;
					said = false;
					const ended = await Promise.race([
						lost.then((reason) => ({ lost: reason })),
						update.then((build) => ({ update: build })),
					]);
					if ("update" in ended) {
						log.info(`the coordinator runs ${ended.update}: restarting on it`);
						await this.disposeAsync();
						return { update: ended.update };
					}
					log.info(`lost ${this.dialer.where}: ${ended.lost}`);
				}
			}
			if (this.stopped) {
				break;
			}
			if (!joined && this.due) {
				this.endOrphaned();
			}
			await this.sleep(jittered(wait, this.opts.random ?? Math.random));
			wait = Duration.min(wait.multiply(2), this.backoff.max);
		}
		return { stopped: true };
	}

	/**
	 * Asks the server on `socket` to sign a nonce of this worker's
	 * choosing, answering why its signature does not hold under `publicKey`,
	 * or null once it does. Nothing of this worker's key has been sent.
	 */
	private async coordinatorProves(
		socket: WorkerSocket,
		publicKey: string,
	): Promise<string | null> {
		const nonce = challengeNonce();
		const answer = new Promise<string | null>((resolve) => {
			const listening = socket.events.on("frame", (encoded) => {
				listening();
				try {
					const frame = WorkerProtocol.decode(encoded);
					if (frame.type !== "proof") {
						resolve(
							`it answered ${frame.type} where a proof of its signing key was due`,
						);
					} else if (
						proofHolds(publicKey, nonce, frame.session, frame.signature)
					) {
						resolve(null);
					} else {
						resolve(
							"its signature is not the one of the key this worker joined",
						);
					}
				} catch {
					resolve("it answered something that is no frame");
				}
			});
			socket.events.on("close", () => resolve("it hung up"), { once: true });
		});
		socket.send(WorkerProtocol.encode({ type: "challenge", nonce }));
		const within = this.opts.proofWithin ?? Duration.secs(10);
		const verdict = await timeouts.race(this.timer, answer, within);
		return verdict ? await answer : `it did not answer within ${within.secs}s`;
	}

	/**
	 * Tells the server this worker's machine is going, as a spot
	 * reclaim's notice says, so its agents carry on elsewhere at once;
	 * answers whether it was told.
	 */
	leaving(reason: string): boolean {
		return this.session.leaving(reason);
	}

	/** Stops dialing and everything this worker runs, and hangs up. */
	async disposeAsync(): Promise<void> {
		this.stopped = true;
		this.orphaned?.dispose();
		this.waiting?.timeout.dispose();
		this.waiting?.wake();
		for (const host of [...this.hosts]) {
			host.dispose();
		}
		this.session.dispose();
	}

	/**
	 * Starts the bound on a lost coordinator. A restart returns in seconds
	 * and takes its channels back; one that does not return within the bound
	 * is gone, and what it left would burn its slot and tokens for good. The
	 * bound counts only time awake, and what it left ends only once a redial
	 * past it fails, so a machine waking from a long sleep reaches its
	 * server before judging it gone.
	 */
	private orphan(): void {
		if (this.stopped) {
			return;
		}
		this.orphaned?.dispose();
		this.due = false;
		this.orphaned = new OrphanBound({
			bound: this.orphanBound,
			timer: this.timer,
			clock: this.clock,
			woke: () => {
				this.opts.log.info(
					`woke without ${this.dialer.where}: redialing before judging it gone`,
				);
				this.redial();
			},
			due: () => {
				this.due = true;
				this.redial();
			},
		});
	}

	/** Ends what a server gone past the bound left. */
	private endOrphaned(): void {
		this.due = false;
		this.orphaned?.dispose();
		this.opts.log.info(
			`no coordinator returned within ${this.orphanBound.secs}s awake; ending what it left`,
		);
		this.session.endChannels();
	}

	/** Cuts short the wait between dials, to dial now. */
	private redial(): void {
		this.waiting?.timeout.dispose();
		this.waiting?.wake();
	}

	private serve(channel: WorkerChannel): void {
		const { ps, log } = this.opts;
		let host: Resource;
		try {
			switch (channel.kind) {
				case "process":
					host = new WorkerProcessHost(channel, this.session, ps, {
						timer: this.timer,
						sandbox: this.opts.sandbox ?? null,
					});
					break;
				case "pty":
					host = new WorkerPtyHost(channel, this.session, ps);
					break;
				case "calls":
					host = new WorkerCallHost(channel, this.machine);
					break;
				case "job":
					host = new WorkerJobHost(
						channel,
						this.session,
						ps,
						this.opts.runnerHome ?? `${splatesHome(ps)}/runner`,
					);
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
		// An agent or a terminal is told of in the log, which says what a
		// restart left running; a call is over in a moment.
		const lasting =
			channel.kind === "process" ||
			channel.kind === "pty" ||
			channel.kind === "job";
		if (lasting) {
			this.running++;
			log.info(`started ${channel.kind} channel ${channel.id}`);
		}
		channel.events.on("close", () => {
			this.hosts.delete(host);
			if (lasting) {
				this.running--;
				log.info(`ended ${channel.kind} channel ${channel.id}`);
			}
		});
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

/**
 * Why `WorkerDaemon.run` stopped: disposed; refused, for speaking another
 * protocol, with the server's build when it says one; or asked to
 * restart on the server's build.
 */
export type WorkerEnded =
	| { stopped: true }
	| { refused: string; update?: string }
	| { update: string };

/**
 * Somewhere in the latter half of `wait`, so workers a server's restart
 * dropped together do not all redial at the same moment.
 */
export function jittered(wait: Duration, random: () => number): Duration {
	return Duration.ms(Math.round(wait.ms * (0.5 + random() / 2)));
}

/** Who a `WorkerDaemon` is and what it runs on. */
export interface WorkerDaemonOptions {
	/** Stays the same across restarts, so the server resumes its session. */
	id: string;
	slots: number;
	ps: Ps;
	fs: Fs;
	log: Logger;
	/** The shortest and longest wait between dials. */
	backoff?: { min: Duration; max: Duration };
	/** Spreads each wait between dials, as `Math.random` by default. */
	random?: () => number;
	/**
	 * How long, awake, the server's session may stay lost before every
	 * channel it held ends, once a redial past it fails; ten minutes by
	 * default.
	 */
	orphanBound?: Duration;
	/** How long a server has to sign the nonce a worker challenges it with; ten seconds by default. */
	proofWithin?: Duration;
	/** Paces the session, as `WorkerSession` takes it. */
	session?: Omit<WorkerSessionOptions, "timer" | "clock" | "capabilities">;
	timer?: Timer;
	clock?: Clock;
	/** Where a runner keeps its warm clones and job checkouts; `runner` under the splates home by default. */
	runnerHome?: string;
	/** Where it runs each agent, kept from the others; none, running each as this worker's user, by default. */
	sandbox?: AgentSandbox | null;
}
