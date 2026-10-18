import type { Resource } from "webappwiz/disposable";
import { PIPE_HANDLERS, PortPipe } from "../ports";
import { LOOPBACK } from "../server/shared";
import { RELAY } from "./channel";
import type { WorkerSession } from "./session";

/**
 * Where `splates` on a worker reaches its coordinator's server: a port on
 * the worker's loopback whose every connection goes up the worker's socket,
 * as a `relay` channel the coordinator pipes into its own server. Agents
 * find it as their `SPLATES_DEV`; `splates` run by hand, in `relay.json`.
 */
export class WorkerRelay implements Resource {
	private constructor(
		private readonly listener: Bun.TCPSocketListener<PortPipe | undefined>,
	) {}

	/**
	 * Listens on any free loopback port. A connection made while the
	 * coordinator cannot take one, since it has not joined or speaks no
	 * relay, is closed at once.
	 */
	static listen(session: WorkerSession): WorkerRelay {
		return new WorkerRelay(
			Bun.listen<PortPipe | undefined>({
				hostname: LOOPBACK,
				port: 0,
				data: undefined,
				socket: {
					...PIPE_HANDLERS,
					open: (socket) => {
						if (!relays(session)) {
							socket.end();
							return;
						}
						socket.data = new PortPipe(session.open(RELAY, {}), session);
						socket.data.attach(socket);
					},
				},
			}),
		);
	}

	/** What a `splates` on this machine reaches the coordinator's server by. */
	get url(): string {
		return `http://${LOOPBACK}:${this.listener.port}`;
	}

	dispose(): void {
		this.listener.stop(true);
	}
}

/** Whether `session`'s coordinator takes relayed connections. */
export function relays(session: WorkerSession): boolean {
	const negotiated = session.negotiated;
	return negotiated?.ok === true && negotiated.capabilities.includes(RELAY);
}
