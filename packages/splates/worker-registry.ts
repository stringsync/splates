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
import { RemoteWorker, type WorkerKind } from "./remote-worker";
import { WORKER_CAPABILITIES } from "./worker-daemon";
import { WorkerSession, type WorkerSessionOptions } from "./worker-session";
import type { WorkerSocket } from "./worker-socket";

/** How long a restart waits for a worker to ack what it was sent. */
const ACK_WAIT = Duration.secs(5);

/** A worker turned away, and why, so the coordinator can drain it. */
export interface RefusedWorker {
	id: string;
	protocol: string;
	reason: string;
}

/** What a `WorkerRegistry` hears. */
export interface WorkerRegistryEvents extends Record<string, unknown> {
	/** A worker connected, for the first time or again. */
	joined: RemoteWorker;
	refused: RefusedWorker;
}

/** How a `WorkerRegistry` paces the sessions it keeps. */
export interface WorkerRegistryOptions {
	/** How long a new connection has to say hello. */
	helloWithin?: Duration;
	session?: Omit<
		WorkerSessionOptions,
		"timer" | "clock" | "wall" | "capabilities"
	>;
	timer?: Timer;
	clock?: Clock;
	wall?: WallClock;
}

/**
 * The coordinator's roster of workers, in memory for now: it takes each
 * connection, on whatever transport, reads its hello, and resumes the session
 * of a worker it knows by its id, so what it was running carries on.
 */
export class WorkerRegistry
	implements Eventful<WorkerRegistryEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<WorkerRegistryEvents>();
	readonly events = this.dispatcher.events;
	private readonly byId = new Map<string, RemoteWorker>();
	private readonly refusals = new Map<string, RefusedWorker>();
	private readonly timer: Timer;
	private readonly clock: Clock;
	private readonly wall: WallClock;

	constructor(
		private readonly log: Logger,
		private readonly opts: WorkerRegistryOptions = {},
	) {
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemClock();
		this.wall = opts.wall ?? new SystemWallClock();
	}

	get workers(): RemoteWorker[] {
		return [...this.byId.values()];
	}

	/** Workers turned away for another major, by id, last word first. */
	get refused(): RefusedWorker[] {
		return [...this.refusals.values()];
	}

	worker(id: string): RemoteWorker | undefined {
		return this.byId.get(id);
	}

	/**
	 * The worker known by `id`, made now if it has yet to join, so work can be
	 * given it before it does: its session keeps what it is sent until then.
	 * `kind` is how it will connect.
	 */
	expect(id: string, kind: WorkerKind = "registered"): RemoteWorker {
		const known = this.byId.get(id);
		if (known !== undefined) {
			return known;
		}
		const worker = new RemoteWorker(id, {}, this.session(), kind);
		this.byId.set(id, worker);
		return worker;
	}

	/**
	 * Takes a worker's new connection, hanging up on one that says nothing in
	 * time. `kind` is how it reached us: `local` over this machine's socket.
	 */
	async accept(
		socket: WorkerSocket,
		kind: WorkerKind = "registered",
	): Promise<void> {
		const hello = WorkerSession.hello(socket);
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
		const known = this.byId.get(said.id);
		const session = known?.session ?? this.session();
		const negotiated = session.accept(socket, said);
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
		const worker = known ?? new RemoteWorker(said.id, said.info, session, kind);
		worker.info = said.info;
		worker.kind = kind;
		this.byId.set(said.id, worker);
		this.dispatcher.dispatch("joined", worker);
	}

	/**
	 * Hangs up on every worker for a restart, keeping what each runs for
	 * the next run to take back, once each holds everything it was sent, or
	 * `ACK_WAIT` is up.
	 */
	async detach(): Promise<void> {
		await Promise.all(
			this.workers.map(async ({ session }) => {
				await timeouts.race(this.timer, session.acked(), ACK_WAIT);
				session.detach();
			}),
		);
	}

	private session(): WorkerSession {
		return new WorkerSession("coordinator", {
			...this.opts.session,
			capabilities: WORKER_CAPABILITIES,
			timer: this.timer,
			clock: this.clock,
			wall: this.wall,
		});
	}

	dispose(): void {
		for (const worker of this.byId.values()) {
			worker.session.dispose();
		}
		this.byId.clear();
		this.dispatcher.dispose();
	}
}
