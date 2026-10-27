import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import {
	type Clock,
	Duration,
	SystemClock,
	SystemTimer,
	SystemWallClock,
	type Timer,
	timeouts,
	type WallClock,
} from "webappwiz/time";
import type { WorkerChannel } from "./channel";
import { WORKER_CAPABILITIES } from "./daemon";
import type { CoordinatorIdentity } from "./identity";
import { LEAVING } from "./protocol";
import { WorkerSession, type WorkerSessionOptions } from "./session";
import type { WorkerSocket } from "./socket";
import {
	CALL_BOUNDS,
	type CallBounds,
	ConnectedWorker,
	type WorkerKind,
} from "./worker";

/** How long a restart waits for a worker to ack what it was sent. */
const ACK_WAIT = Duration.secs(5);

/** A worker turned away, and why, so the server can drain it. */
export interface RefusedWorker {
	id: string;
	protocol: string;
	reason: string;
}

/** What a `WorkerRegistry` hears. */
export interface WorkerRegistryEvents extends Record<string, unknown> {
	/** A worker connected, for the first time or again. */
	joined: ConnectedWorker;
	refused: RefusedWorker;
	/** A worker said its machine is about to be taken away. */
	leaving: { id: string; reason: string };
}

/** How a `WorkerRegistry` paces the sessions it keeps. */
export interface WorkerRegistryOptions {
	/** How long a new connection has to say hello. */
	helloWithin?: Duration;
	/** How long each kind of call to a worker may go unanswered. */
	calls?: Partial<CallBounds>;
	session?: Omit<
		WorkerSessionOptions,
		"timer" | "clock" | "wall" | "capabilities"
	>;
	timer?: Timer;
	clock?: Clock;
	wall?: WallClock;
	/** What proves this server to a worker that keeps its public key; none answers no challenge. */
	identity?: CoordinatorIdentity;
	/** Whether `key` is the one worker `id` joined with, for a worker that sends it in its hello. */
	verify?: (id: string, key: string) => boolean;
}

/**
 * The server's roster of workers, in memory for now: it takes each
 * connection, on whatever transport, reads its hello, and resumes the session
 * of a worker it knows by its id, so what it was running carries on.
 */
export class WorkerRegistry
	implements Eventful<WorkerRegistryEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<WorkerRegistryEvents>();
	readonly events = this.dispatcher.events;
	private readonly byId = new Map<string, ConnectedWorker>();
	private readonly refusals = new Map<string, RefusedWorker>();
	private readonly timer: Timer;
	private readonly clock: Clock;
	private readonly wall: WallClock;
	/**
	 * Detached for a restart, or disposed: a worker that redials now is hung
	 * up on, since a fresh session's welcome would have it end everything it
	 * kept for the next run.
	 */
	private closed = false;

	/** What the server signs a worker's nonce with, new for each run unless its session is given. */
	private readonly proofSession: string;

	constructor(
		private readonly log: Logger,
		private readonly opts: WorkerRegistryOptions = {},
	) {
		this.proofSession = opts.session?.id ?? crypto.randomUUID();
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemClock();
		this.wall = opts.wall ?? new SystemWallClock();
	}

	get workers(): ConnectedWorker[] {
		return [...this.byId.values()];
	}

	/** Workers turned away for another major, by id, last word first. */
	get refused(): RefusedWorker[] {
		return [...this.refusals.values()];
	}

	worker(id: string): ConnectedWorker | undefined {
		return this.byId.get(id);
	}

	/**
	 * The worker known by `id`, made now if it has yet to join, so work can be
	 * given it before it does: its session keeps what it is sent until then.
	 * `kind` is how it will connect.
	 */
	expect(id: string, kind: WorkerKind = "registered"): ConnectedWorker {
		const known = this.byId.get(id);
		if (known !== undefined) {
			return known;
		}
		const worker = new ConnectedWorker(
			id,
			{},
			this.session(),
			kind,
			this.bounds(),
		);
		this.byId.set(id, worker);
		return worker;
	}

	/**
	 * Takes a worker's new connection, hanging up on one that says nothing in
	 * time. `kind` is how it reached us: `local` over this machine's socket.
	 * `identity`, when a string, is the worker its key proved it to be, and a
	 * hello saying it is another is hung up on; when a function, it says
	 * which ids a hello may name, as this machine's socket takes its own
	 * workers alone; null, the worker proves
	 * itself in its hello, with the key it joined with, once it has had this
	 * server sign its nonce.
	 */
	async accept(
		socket: WorkerSocket,
		kind: WorkerKind = "registered",
		identity?: string | null | ((id: string) => boolean),
	): Promise<void> {
		const { identity: signer } = this.opts;
		const hello = WorkerSession.hello(
			socket,
			signer === undefined
				? undefined
				: (nonce) => ({
						type: "proof",
						session: this.proofSession,
						signature: signer.prove(nonce, this.proofSession),
					}),
		);
		const answered = await timeouts.race(
			this.timer,
			hello,
			this.opts.helloWithin ?? Duration.secs(10),
		);
		if (!answered) {
			socket.dispose();
			this.log.error("a worker connected and said no hello: hung up");
			return;
		}
		const said = await hello.catch((error: unknown) => {
			this.log.error(`a worker's hello could not be read: ${String(error)}`);
			return null;
		});
		if (said === null) {
			return;
		}
		if (identity === null) {
			if (said.key === undefined || !this.opts.verify?.(said.id, said.key)) {
				socket.dispose();
				this.log.error(
					`a worker said it was ${said.id} without the key it joined with: hung up`,
				);
				return;
			}
		} else if (typeof identity === "function") {
			if (!identity(said.id)) {
				socket.dispose();
				this.log.error(`a worker said it was ${said.id}: hung up`);
				return;
			}
		} else if (identity !== undefined && said.id !== identity) {
			socket.dispose();
			this.log.error(
				`a worker with the key of ${identity} said it was ${said.id}: hung up`,
			);
			return;
		}
		if (this.closed) {
			socket.dispose();
			return;
		}
		const known = this.byId.get(said.id);
		const session = known?.session ?? this.session();
		const negotiated = session.accept(socket, said);
		if (!negotiated.ok && !negotiated.refused) {
			this.log.error(`dropped worker ${said.id}: ${negotiated.reason}`);
			return;
		}
		if (!negotiated.ok) {
			const refused = {
				id: said.id,
				protocol: said.protocol,
				reason: negotiated.reason,
			};
			this.refusals.set(said.id, refused);
			this.log.error(`refused worker ${said.id}: ${negotiated.reason}`);
			this.dispatcher.dispatch("refused", refused);
			return;
		}
		this.refusals.delete(said.id);
		const worker =
			known ??
			new ConnectedWorker(said.id, said.info, session, kind, this.bounds());
		worker.info = said.info;
		// Proved by a key sent only after this server proved itself; a
		// key in the upgrade went to whoever answered, and cannot be told.
		worker.verified = identity === null || kind === "local";
		worker.kind = kind;
		this.byId.set(said.id, worker);
		this.dispatcher.dispatch("joined", worker);
	}

	/**
	 * Hangs up on worker `id` for good, ending what it runs, and forgets it;
	 * answers whether it was known.
	 */
	forget(id: string): boolean {
		const worker = this.byId.get(id);
		this.refusals.delete(id);
		if (worker === undefined) {
			return false;
		}
		this.byId.delete(id);
		worker.session.dispose();
		return true;
	}

	/**
	 * Hangs up on every worker for a restart, keeping what each runs for
	 * the next run to take back, once each holds everything it was sent, or
	 * `ACK_WAIT` is up.
	 */
	async detach(): Promise<void> {
		this.closed = true;
		await Promise.all(
			this.workers.map(async ({ session }) => {
				await timeouts.race(this.timer, session.acked(), ACK_WAIT);
				session.detach();
			}),
		);
	}

	private bounds(): CallBounds {
		return { ...CALL_BOUNDS, ...this.opts.calls };
	}

	private session(): WorkerSession {
		const session = new WorkerSession("coordinator", {
			...this.opts.session,
			capabilities: [...WORKER_CAPABILITIES, LEAVING],
			timer: this.timer,
			clock: this.clock,
			wall: this.wall,
		});
		session.events.on("channel", (channel) => this.serve(channel));
		session.events.on("leaving", ({ reason }) => {
			const worker = this.workers.find((each) => each.session === session);
			if (worker !== undefined) {
				this.log.info(`worker ${worker.id} is leaving: ${reason}`);
				this.dispatcher.dispatch("leaving", { id: worker.id, reason });
			}
		});
		// Said, since a worker hung up on redials at once and says nothing.
		session.events.on("lost", ({ reason }) => {
			const worker = this.workers.find((each) => each.session === session);
			if (!this.closed && worker !== undefined) {
				this.log.info(`lost worker ${worker.id}: ${reason}`);
			}
		});
		return session;
	}

	// Closed rather than left open: its frames would never be acked, and
	// would fill the worker's buffer until it stopped.
	private serve(channel: WorkerChannel): void {
		this.log.error(
			`a worker opened a ${channel.kind} channel, which this coordinator does not serve`,
		);
		channel.dispose();
	}

	dispose(): void {
		this.closed = true;
		for (const worker of this.byId.values()) {
			worker.session.dispose();
		}
		this.byId.clear();
		this.dispatcher.dispose();
	}
}
