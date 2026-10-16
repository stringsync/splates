import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { hostname, LOCAL_HOSTS, refuse } from "./dev-http";
import type { Connection } from "./dev-sockets";
import { ServerWorkerSocket } from "./server-worker-socket";
import { UnixWorkerListener } from "./unix-worker-listener";
import { WorkerRegistry } from "./worker-registry";

/**
 * Where `arbor dev` takes its workers in, as their coordinator: the local
 * worker through a Unix socket only this user may open, and others through
 * `/api/workers`. Nothing places work on them yet; the registry keeps them
 * for what comes next.
 */
export class DevWorkers implements AsyncResource {
	readonly registry: WorkerRegistry;
	private listener: UnixWorkerListener | null = null;

	constructor(private readonly log: Logger) {
		this.registry = new WorkerRegistry(log);
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
				(socket) => void this.registry.accept(socket),
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

	async disposeAsync(): Promise<void> {
		this.registry.dispose();
		await this.listener?.disposeAsync();
	}
}
