import { Disposer, type Resource } from "webappwiz/disposable";
import type { Duration } from "webappwiz/time";
import type { Negotiated } from "./worker-protocol";
import type { WorkerSocket } from "./worker-socket";

/**
 * One socket's worth of a `WorkerSession`: what goes when the socket does,
 * while the session's channels and unacked frames stay for the next one.
 */
export class WorkerConnection implements Resource {
	readonly resources = new Disposer();
	/** Settles with the handshake, or with why the socket went first. */
	readonly settled = Promise.withResolvers<Negotiated>();
	/** Past the handshake, so channel frames flow. */
	live = false;
	ackFlush: Resource | undefined;

	constructor(
		readonly socket: WorkerSocket,
		public heard: Duration,
	) {}

	dispose(): void {
		this.ackFlush?.dispose();
		this.resources.dispose();
		this.socket.dispose();
	}
}
