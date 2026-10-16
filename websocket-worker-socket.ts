import { Dispatcher } from "webappwiz/events";
import type { WorkerSocket, WorkerSocketEvents } from "./worker-socket";

/**
 * A `WorkerSocket` over a WebSocket the worker dials, as a remote worker
 * reaches its coordinator's `/api/workers`: each frame is one message, text
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

	/** Dials `url`, settling once the socket is open. */
	static connect(url: string): Promise<WebSocketWorkerSocket> {
		const socket = new WebSocket(url);
		return new Promise((resolve, reject) => {
			socket.addEventListener("open", () =>
				resolve(new WebSocketWorkerSocket(socket)),
			);
			socket.addEventListener("error", () =>
				reject(new Error(`cannot reach the coordinator at ${url}`)),
			);
		});
	}

	send(frame: string | Uint8Array): void {
		if (this.open) {
			// Every frame the protocol makes is backed by a plain ArrayBuffer.
			this.socket.send(frame as string | Uint8Array<ArrayBuffer>);
		}
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
