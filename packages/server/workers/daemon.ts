import type { MemorySecretStore } from "webappwiz/creds";
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
import type { SessionServers } from "../agents";
import type { RelayFile } from "../records";
import { RUNNING } from "../server/shared";
import type { Document } from "../storage";
import type { KeepAwake } from "./awake";
import { AwakeWhileBusy } from "./awake-while-busy";
import { SERVERS, WorkerCallHost } from "./call-host";
import { RELAY, type WorkerChannel } from "./channel";
import { challengeNonce, proofHolds } from "./identity";
import { hostOf, LocalWorkerMachine } from "./machine";
import { WAKE, type WakeSender } from "./magic-packet";
import { OrphanBound } from "./orphan";
import { WorkerPortHost } from "./port-host";
import { WorkerProcessHost } from "./process-host";
import { UPDATE, WorkerProtocol } from "./protocol";
import { WorkerPtyHost } from "./pty-host";
import { WorkerRelay } from "./relay";
import type { AgentSandbox } from "./sandbox";
import { WorkerSession, type WorkerSessionOptions } from "./session";
import type { WorkerSocket } from "./socket";
import { KEYS } from "./task-keys";
import type { WorkerNetwork } from "./wake";

/** How a worker reaches its coordinator, dialed afresh after each drop. */
export interface WorkerDialer {
	/** Where it dials, for the log. */
	readonly where: string;
	dial(): Promise<WorkerSocket>;
	/**
	 * The coordinator's public key to check on each dial, and the key to send
	 * once it has proved itself; absent for a coordinator not checked.
	 */
	readonly verify?: { coordinator: string; key: string };
}

/** The channels a worker serves, which it says it can in its hello. */
export const WORKER_CAPABILITIES = [
	"process",
	"pty",
	"calls",
	"port",
	RELAY,
	SERVERS,
	UPDATE,
	WAKE,
];

/**
 * `splates worker run`: a worker that dials out to its coordinator and keeps
 * dialing, waiting longer after each failure, and runs what it is asked to
 * on this machine: processes, PTYs, calls, and connections to the ports its
 * tasks serve. What it runs outlives a
 * dropped link, since the session replays what the coordinator missed.
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
	/** The bound passed awake: what the coordinator left ends once a redial fails. */
	private due = false;
	/** Where `splates` on this machine reaches the coordinator, once running. */
	private relay: WorkerRelay | null = null;
	private waiting: { wake(): void; timeout: Resource } | undefined;
	private stopped = false;
	private readonly busy: AwakeWhileBusy;
	/** The keys its coordinator sent, in this process's memory alone. */
	private readonly keys: MemorySecretStore | null;

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
		this.busy = new AwakeWhileBusy(opts.awake ?? null);
		this.keys = opts.keys ?? null;
		this.machine = new LocalWorkerMachine(
			opts.ps,
			opts.fs,
			opts.servers ?? null,
		);
		this.session = new WorkerSession("worker", {
			...opts.session,
			capabilities:
				this.keys === null
					? WORKER_CAPABILITIES
					: [...WORKER_CAPABILITIES, KEYS],
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
	 * Dials and serves until disposed, until the coordinator refuses this
	 * worker, or until it asks this one to restart on its build, resolving
	 * with why it stopped: a refusal names that build too, from a
	 * coordinator that says it.
	 */
	async run(): Promise<WorkerEnded> {
		const { log, relay = null } = this.opts;
		const host = hostOf(this.opts.ps);
		this.relay = WorkerRelay.listen(this.session);
		if (relay !== null && this.relay !== null) {
			await relay
				.write({
					url: this.relay.url,
					worker: this.opts.id,
					...this.opts.direct,
				})
				.catch((error: unknown) =>
					log.error(`cannot say where the relay listens: ${String(error)}`),
				);
		}
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
						// It clones each project and task it runs agents in (`checkout`).
						checkouts: true,
						...hello(this.opts.network ?? null),
					},
				});
				if (!negotiated.ok && negotiated.refused) {
					this.keys?.clear();
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
	 * Asks the coordinator on `socket` to sign a nonce of this worker's
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

	/** Stops dialing and everything this worker runs, and hangs up. */
	async disposeAsync(): Promise<void> {
		this.stopped = true;
		this.keys?.clear();
		this.orphaned?.dispose();
		this.waiting?.timeout.dispose();
		this.waiting?.wake();
		for (const host of [...this.hosts]) {
			host.dispose();
		}
		this.session.dispose();
		if (this.relay !== null) {
			this.relay.dispose();
			const { relay = null } = this.opts;
			// Another daemon on this machine may have said its own since.
			const said = relay === null ? null : await relay.read().catch(() => null);
			if (relay !== null && said?.url === this.relay.url) {
				// Kept without the relay, so `splates` here reaches a
				// coordinator elsewhere directly while no daemon runs.
				const { direct } = this.opts;
				await (direct === undefined
					? relay.remove()
					: relay.write({ worker: this.opts.id, ...direct })
				).catch(() => {});
			}
			this.relay = null;
		}
	}

	/**
	 * Starts the bound on a lost coordinator. A restart returns in seconds
	 * and takes its channels back; one that does not return within the bound
	 * is gone, and what it left would burn its slot and tokens for good. The
	 * bound counts only time awake, and what it left ends only once a redial
	 * past it fails, so a machine waking from a long sleep reaches its
	 * coordinator before judging it gone.
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

	/** Ends what a coordinator gone past the bound left. */
	private endOrphaned(): void {
		this.due = false;
		this.orphaned?.dispose();
		this.opts.log.info(
			`no coordinator returned within ${this.orphanBound.secs}s awake; ending what it left`,
		);
		this.session.endChannels();
		// Whoever comes next sends its own.
		this.keys?.clear();
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
						relay: this.relay,
						timer: this.timer,
						store: this.keys,
						sandbox: this.opts.sandbox ?? null,
					});
					break;
				case "pty":
					host = new WorkerPtyHost(channel, this.session, ps);
					break;
				case "calls":
					host = new WorkerCallHost(
						channel,
						this.machine,
						this.opts.waker ?? null,
						this.keys,
					);
					break;
				case "port":
					host = new WorkerPortHost(channel, this.session);
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
		// An agent or a terminal keeps the machine up, and is told of in the
		// log, which says what a restart left running; a call or a port is
		// over in a moment.
		const lasting = channel.kind === "process" || channel.kind === "pty";
		const busy = lasting ? this.busy.busy() : null;
		if (lasting) {
			this.running++;
			log.info(`started ${channel.kind} channel ${channel.id}`);
		}
		channel.events.on("close", () => {
			this.hosts.delete(host);
			busy?.dispose();
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
 * What a hello says of `network`: the broadcast addresses this worker can
 * wake another on, and, only for one that may sleep, what waking it takes.
 */
function hello(network: WorkerNetwork | null) {
	if (network === null) {
		return {};
	}
	return {
		broadcasts: network.broadcasts,
		...(network.wake === null ? {} : { wake: { ...network.wake } }),
	};
}

/**
 * Why `WorkerDaemon.run` stopped: disposed; refused, for speaking another
 * protocol, with the coordinator's build when it says one; or asked to
 * restart on the coordinator's build.
 */
export type WorkerEnded =
	| { stopped: true }
	| { refused: string; update?: string }
	| { update: string };

/**
 * Somewhere in the latter half of `wait`, so workers a coordinator's restart
 * dropped together do not all redial at the same moment.
 */
export function jittered(wait: Duration, random: () => number): Duration {
	return Duration.ms(Math.round(wait.ms * (0.5 + random() / 2)));
}

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
	/** Spreads each wait between dials, as `Math.random` by default. */
	random?: () => number;
	/**
	 * How long, awake, the coordinator's session may stay lost before every
	 * channel it held ends, once a redial past it fails; ten minutes by
	 * default.
	 */
	orphanBound?: Duration;
	/** How long a coordinator has to sign the nonce a worker challenges it with; ten seconds by default. */
	proofWithin?: Duration;
	/** Paces the session, as `WorkerSession` takes it. */
	session?: Omit<WorkerSessionOptions, "timer" | "clock" | "capabilities">;
	timer?: Timer;
	clock?: Clock;
	/**
	 * Where to say the relay listens, for `splates` run by hand on this
	 * machine, which has no env to find it in; null, the default, says it
	 * nowhere.
	 */
	relay?: Document<RelayFile> | null;
	/**
	 * The coordinator elsewhere it dials, said beside the relay, and kept
	 * once it stops, with whether its key and Access token are in the key
	 * file; none for this machine's own.
	 */
	direct?: { coordinator: string; keyFile: boolean };
	/** The MCP servers it offers each agent session it runs; none by default. */
	servers?: SessionServers | null;
	/** Keeps the machine awake while it runs a process or terminal; none by default. */
	awake?: KeepAwake | null;
	/**
	 * The network it says in its hello: where it can send a magic packet
	 * for the coordinator, and what waking this machine takes, for one that
	 * may sleep; none by default.
	 */
	network?: WorkerNetwork | null;
	/** What sends a magic packet when the coordinator asks; none by default. */
	waker?: WakeSender | null;
	/**
	 * Where it keeps the API keys its coordinator sends for its agents,
	 * which it proxies so no agent holds one; none, for a worker whose
	 * agents run signed in as the person, by default. Make the process
	 * undumpable before it holds one.
	 */
	keys?: MemorySecretStore | null;
	/** Where it runs each agent, kept from the others; none, running each as this worker's user, by default. */
	sandbox?: AgentSandbox | null;
}
