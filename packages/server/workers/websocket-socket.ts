import { Dispatcher } from "webappwiz/events";
import { Duration } from "webappwiz/time";
import { WorkerProtocol } from "./protocol";
import type { WorkerSocket, WorkerSocketEvents } from "./socket";

/** How much a socket may hold unsent before it is given up on. */
const MAX_BUFFERED = 2 * WorkerProtocol.maxPayloadBytes;

/**
 * A `WorkerSocket` over a WebSocket the worker dials, as a remote worker
 * reaches its server's `/api/workers`: each frame is one message, text
 * or binary as the protocol has it.
 */
export class WebSocketWorkerSocket implements WorkerSocket {
	private readonly dispatcher = new Dispatcher<WorkerSocketEvents>();
	readonly events = this.dispatcher.events;
	private open = true;

	private constructor(private readonly socket: WebSocket) {
		socket.binaryType = "arraybuffer";
		socket.addEventListener("message", (event) => {
			const data: unknown = event.data;
			this.dispatcher.dispatch(
				"frame",
				typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer),
			);
		});
		socket.addEventListener("close", () => this.closed());
	}

	/**
	 * Dials `url` with `headers`, settling once the socket is open, or
	 * rejecting once `within` is up: a box that takes the connection and
	 * never answers would otherwise hold the dial, and the worker's retries
	 * behind it, for good.
	 */
	static connect(
		url: string,
		headers: Record<string, string> = {},
		within: Duration = Duration.secs(15),
	): Promise<WebSocketWorkerSocket> {
		// Bun's constructor takes headers; the DOM's, in scope too, does not.
		const options: Bun.WebSocketOptions = { headers };
		const socket = new WebSocket(url, options as string[]);
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				socket.close();
				reject(
					new Error(
						`no answer from the coordinator at ${url} within ${within.secs}s`,
					),
				);
			}, within.ms);
			socket.addEventListener("open", () => {
				clearTimeout(timeout);
				resolve(new WebSocketWorkerSocket(socket));
			});
			socket.addEventListener("error", () => {
				clearTimeout(timeout);
				reject(new Error(`cannot reach the coordinator at ${url}`));
			});
		});
	}

	send(frame: string | Uint8Array): boolean {
		if (!this.open) {
			return false;
		}
		// A server that stops reading leaves frames piling up here; past
		// the most a session holds unacked, hang up and replay on a new link.
		if (this.socket.bufferedAmount > MAX_BUFFERED) {
			this.dispose();
			return false;
		}
		// Every frame the protocol makes is backed by a plain ArrayBuffer.
		this.socket.send(frame as string | Uint8Array<ArrayBuffer>);
		return true;
	}

	dispose(): void {
		this.socket.close();
		this.closed();
	}

	private closed(): void {
		if (!this.open) {
			return;
		}
		this.open = false;
		this.dispatcher.dispatch("close");
		this.dispatcher.dispose();
	}
}
