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
	send(frame: string | Uint8Array): void;
}
