import type { Resource } from "webappwiz/disposable";
import type { Eventful } from "webappwiz/events";

/** What a `WorkerSocket` hears: one whole frame, or that it is gone. */
export interface WorkerSocketEvents extends Record<string, unknown> {
	frame: string | Uint8Array;
	close: undefined;
}

/**
 * One connection between a coordinator and a worker, carrying whole frames in
 * order: a WebSocket as it is, or a Unix socket behind length-prefixed
 * framing. Disposing it hangs up, and both ends then hear `close`.
 */
export interface WorkerSocket extends Eventful<WorkerSocketEvents>, Resource {
	/**
	 * Queues `frame` and says whether the socket still carries it. False means
	 * it is gone or dropped the frame, in which case it hangs up itself, so
	 * both ends hear `close` and the session replays the frame on the next
	 * connection.
	 */
	send(frame: string | Uint8Array): boolean;
}
