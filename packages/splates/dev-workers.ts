import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { hostname, LOCAL_HOSTS, refuse } from "./dev-http";
import type { Connection } from "./dev-sockets";
import { systemPs } from "./legacy-ps";
import { queueListing } from "./queue-list";
import type { RemoteWorker } from "./remote-worker";
import { ServerWorkerSocket } from "./server-worker-socket";
import { UnixWorkerListener } from "./unix-worker-listener";
import { workerList } from "./worker-list";
import { WorkerRegistry } from "./worker-registry";
import { WorkerSlots } from "./worker-slots";
import type { WorkerMachines } from "./worktree-service";

/** What the worker the supervisor starts beside the server is known by. */
export const LOCAL_WORKER = "local";

/** What `PUT /api/queue/:id/position` is sent. */
const QueueMove = z.object({ position: z.number().int() });

/** What `DevWorkers` answers workers as. */
export interface DevWorkersOptions {
	/**
	 * The session id every worker hears in its welcome: the same across
	 * restarts, so a worker keeps what it runs for the next run to take
	 * back; new by default, which ends what the worker held.
	 */
	session?: string;
	/** The protocol the last run spoke, which a worker's channels are taken back by only when its major is this one's. */
	protocol?: string;
	/** This machine's `ps.platform`, the local worker's until its hello says. */
	platform?: string;
}

/**
 * Where `splates server` takes its workers in, as their coordinator: the local
 * worker through a Unix socket only this user may open, and others through
 * `/api/workers`, and every agent another agent starts waits in `slots`
 * for room on one.
 */
export class DevWorkers implements AsyncResource, WorkerMachines {
	readonly registry: WorkerRegistry;
	/** The queue the agents other agents start take a slot on a worker from. */
	readonly slots: WorkerSlots;
	/** This machine's worker, which agents run on; work waits for it to join. */
	readonly local: RemoteWorker;
	private listener: UnixWorkerListener | null = null;
	/** Whether a worker may join: not while what the last run let go of is being taken back. */
	private ready = true;

	constructor(
		private readonly log: Logger,
		{
			session,
			protocol,
			platform = systemPs().platform,
		}: DevWorkersOptions = {},
	) {
		// Acked by hand: an agent's frame is acked once its log holds it, so
		// a restart replays from where the log leaves off.
		this.registry = new WorkerRegistry(log, {
			session: {
				...(session === undefined ? {} : { id: session }),
				...(protocol === undefined ? {} : { resumedProtocol: protocol }),
				acks: "manual",
			},
		});
		this.local = this.registry.expect(LOCAL_WORKER, "local");
		this.slots = new WorkerSlots(this.registry, { platform });
	}

	/** The worker `id`, as a project reads a task cloned there through it. */
	machine(id: string): RemoteWorker | null {
		return this.registry.worker(id) ?? null;
	}

	/**
	 * Turns workers away until `serving`, while the conversations the last
	 * run let go of take their processes back, since a worker's hello
	 * settles which channels live on.
	 */
	takingBack(): void {
		this.ready = false;
	}

	/**
	 * Lets workers join again, their relays reaching the server at `port`
	 * on this machine's loopback.
	 */
	serving(port: number): void {
		this.registry.relayTo(port);
		this.ready = true;
	}

	/** Hangs up on every worker for a restart, keeping what each runs (see `WorkerRegistry.detach`). */
	detach(): Promise<void> {
		return this.registry.detach();
	}

	/**
	 * Listens at `path`, logging rather than failing when it cannot, as when
	 * another `splates server` with the same home already does: the page works
	 * without workers.
	 */
	async listen(path: string, fs: Fs): Promise<void> {
		try {
			const listener = await UnixWorkerListener.listen(path, fs);
			listener.events.on(
				"socket",
				(socket) => void this.registry.accept(socket, "local"),
			);
			this.listener = listener;
		} catch (error) {
			this.log.error(`no local worker socket: ${String(error)}`);
		}
	}

	// A worker runs whatever its coordinator asks, so until workers join with
	// tokens of their own, only this machine's names may connect one, and never
	// a page: a browser always sends an Origin, a worker never does.
	readonly open = (
		request: Request,
		server: Bun.Server<Connection>,
	): Response | undefined => {
		if (!this.ready) {
			return refuse(
				503,
				"unavailable",
				"splates server is still taking back what its last run left: dial again",
			);
		}
		const host = request.headers.get("host") ?? "";
		if (!LOCAL_HOSTS.includes(hostname(host))) {
			return refuse(
				403,
				"forbidden",
				"workers connect on this machine only, for now",
			);
		}
		if (request.headers.get("origin") !== null) {
			return refuse(403, "forbidden", "a page cannot connect a worker");
		}
		return server.upgrade(request, {
			data: new ServerWorkerSocket(this.registry),
		})
			? undefined
			: refuse(400, "usage", "a worker connects with a WebSocket");
	};

	/** `GET /api/workers`: each worker and each refusal, as `splates worker list` shows them. */
	readonly list = async (): Promise<Response> =>
		Response.json(workerList(this.registry, this.slots.used()));

	/**
	 * `GET /api/queue`: every agent waiting for a slot, first in line first,
	 * from every project, as `splates queue list` shows them.
	 */
	readonly queue = async (): Promise<Response> =>
		Response.json({ queue: queueListing(this.slots.scheduler.queue()) });

	/**
	 * `PUT /api/queue/:id/position`: moves the agent of conversation `id` to
	 * `position` in the queue, from 1, answering the queue as it stands.
	 */
	readonly moveQueued = async (request: Request): Promise<Response> => {
		const id = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const body = QueueMove.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return refuse(400, "usage", "say the position to move it to, from 1");
		}
		if (!this.slots.scheduler.move(id, body.data.position)) {
			return refuse(404, "not_found", `conversation ${id} is not in the queue`);
		}
		return this.queue();
	};

	/** A worker upgrades; anyone else is asking who has joined, and `guard` decides who may. */
	readonly route = (
		request: Request,
		server: Bun.Server<Connection>,
		guard: (
			handle: (request: Request) => Promise<Response>,
		) => (request: Request) => Promise<Response>,
	): Response | undefined | Promise<Response> =>
		request.headers.get("upgrade") === null
			? guard(this.list)(request)
			: this.open(request, server);

	async disposeAsync(): Promise<void> {
		this.slots.dispose();
		this.registry.dispose();
		await this.listener?.disposeAsync();
	}
}
