import type { Resource } from "webappwiz/disposable";
import { LOOPBACK } from "./dev-http";
import { PIPE_HANDLERS, PortPipe } from "./port-pipe";
import type { RemoteWorker } from "./remote-worker";

/**
 * A loopback port on the coordinator standing in for `port` on a worker:
 * each connection made to it goes down the worker's socket as a `port`
 * channel, so a task's dev server opens here wherever its worker runs.
 */
export class PortForward implements Resource {
	private constructor(
		readonly worker: RemoteWorker,
		/** The worker's port, which this forwards to. */
		readonly port: number,
		private readonly listener: Bun.TCPSocketListener<PortPipe | undefined>,
	) {}

	/**
	 * Listens on `prefer` when it is free, so the task's port keeps its
	 * number here, and on any free port when not.
	 */
	static listen(
		worker: RemoteWorker,
		port: number,
		prefer: number | null = null,
	): PortForward {
		const listen = (at: number) =>
			Bun.listen<PortPipe | undefined>({
				hostname: LOOPBACK,
				port: at,
				data: undefined,
				socket: {
					...PIPE_HANDLERS,
					open: (socket) => {
						socket.data = new PortPipe(worker.port(port), worker.session);
						socket.data.attach(socket);
					},
				},
			});
		let listener: Bun.TCPSocketListener<PortPipe | undefined>;
		try {
			listener = listen(prefer ?? 0);
		} catch (error) {
			if (prefer === null) {
				throw error;
			}
			listener = listen(0);
		}
		return new PortForward(worker, port, listener);
	}

	/** The coordinator's port it listens on. */
	get local(): number {
		return this.listener.port;
	}

	dispose(): void {
		this.listener.stop(true);
	}
}
