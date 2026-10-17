import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { hostname, LOCAL_HOSTS, refuse } from "./dev-http";
import type { Connection } from "./dev-sockets";
import type { RemoteWorker } from "./remote-worker";
import { ServerWorkerSocket } from "./server-worker-socket";
import { UnixWorkerListener } from "./unix-worker-listener";
import { workerList } from "./worker-list";
import { WorkerRegistry } from "./worker-registry";

/** What the worker the supervisor starts beside the server is known by. */
export const LOCAL_WORKER = "local";

/** What `DevWorkers` answers workers as. */
export interface DevWorkersOptions {
	/**
	 * The session id every worker hears in its welcome: the same across
	 * restarts, so a worker keeps what it runs for the next run to take
	 * back; new by default, which ends what the worker held.
	 */
	session?: string;
}

/**
 * Where `arbor dev` takes its workers in, as their coordinator: the local
 * worker through a Unix socket only this user may open, and others through
 * `/api/workers`. Nothing places work on them yet; the registry keeps them
 * for what comes next.
 */
export class DevWorkers implements AsyncResource {
	readonly registry: WorkerRegistry;
	/** This machine's worker, which agents run on; work waits for it to join. */
	readonly local: RemoteWorker;
	private listener: UnixWorkerListener | null = null;
	/** Whether a worker may join: not while what the last run let go of is being taken back. */
	private ready = true;

	constructor(
		private readonly log: Logger,
		{ session }: DevWorkersOptions = {},
	) {
		// Acked by hand: an agent's frame is acked once its log holds it, so
		// a restart replays from where the log leaves off.
		this.registry = new WorkerRegistry(log, {
			session: {
				...(session === undefined ? {} : { id: session }),
				acks: "manual",
			},
		});
		this.local = this.registry.expect(LOCAL_WORKER, "local");
	}

	/**
	 * Turns workers away until `serving`, while the conversations the last
	 * run let go of take their processes back, since a worker's hello
	 * settles which channels live on.
	 */
	takingBack(): void {
		this.ready = false;
	}

	/** Lets workers join again. */
	serving(): void {
		this.ready = true;
	}

	/** Hangs up on every worker for a restart, keeping what each runs (see `WorkerRegistry.detach`). */
	detach(): Promise<void> {
		return this.registry.detach();
	}

	/**
	 * Listens at `path`, logging rather than failing when it cannot, as when
	 * another `arbor dev` with the same home already does: the page works
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
				"arbor dev is still taking back what its last run left: dial again",
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

	/** `GET /api/workers`: each worker and each refusal, as `arbor worker list` shows them. */
	readonly list = async (): Promise<Response> =>
		Response.json(workerList(this.registry));

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
		this.registry.dispose();
		await this.listener?.disposeAsync();
	}
}
