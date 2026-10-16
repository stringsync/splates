import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import {
	type Clock,
	Duration,
	SystemClock,
	SystemTimer,
	type Timer,
	timeouts,
} from "webappwiz/time";
import { RemoteWorker } from "./remote-worker";
import { WORKER_CAPABILITIES } from "./worker-daemon";
import { WorkerSession, type WorkerSessionOptions } from "./worker-session";
import type { WorkerSocket } from "./worker-socket";

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
	session?: Omit<WorkerSessionOptions, "timer" | "clock" | "capabilities">;
	timer?: Timer;
	clock?: Clock;
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

	constructor(
		private readonly log: Logger,
		private readonly opts: WorkerRegistryOptions = {},
	) {
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemClock();
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

	/** Takes a worker's new connection, hanging up on one that says nothing in time. */
	async accept(socket: WorkerSocket): Promise<void> {
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
		const session =
			known?.session ??
			new WorkerSession("coordinator", {
				...this.opts.session,
				capabilities: WORKER_CAPABILITIES,
				timer: this.timer,
				clock: this.clock,
			});
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
		const worker = known ?? new RemoteWorker(said.id, said.info, session);
		worker.info = said.info;
		this.byId.set(said.id, worker);
		this.dispatcher.dispatch("joined", worker);
	}

	dispose(): void {
		for (const worker of this.byId.values()) {
			worker.session.dispose();
		}
		this.byId.clear();
		this.dispatcher.dispose();
	}
}
