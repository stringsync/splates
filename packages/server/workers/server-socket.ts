import { Dispatcher } from "webappwiz/events";
import type { Connection } from "../server/shared";
import type { WorkerRegistry } from "./registry";
import type { WorkerSocket, WorkerSocketEvents } from "./socket";

/**
 * A worker's WebSocket as `splates server` upgraded it on `/api/workers`, seen as
 * a `WorkerSocket`: the server hands it each socket event, and it hands
 * itself to the registry once open.
 */
export class ServerWorkerSocket implements WorkerSocket, Connection {
	private readonly dispatcher = new Dispatcher<WorkerSocketEvents>();
	readonly events = this.dispatcher.events;
	private socket: Bun.ServerWebSocket<Connection> | undefined;
	private live = true;

	constructor(
		private readonly registry: WorkerRegistry,
		/** The worker its key proved it to be. */
		private readonly identity: string,
	) {}

	send(frame: string | Uint8Array): boolean {
		if (!this.live || !this.socket) {
			return false;
		}
		// Bun answers -1 for a frame it queued behind a full buffer, which still
		// arrives in order, and 0 for one it dropped, which never will.
		const sent =
			typeof frame === "string"
				? this.socket.send(frame)
				: this.socket.sendBinary(frame);
		if (sent === 0) {
			this.dispose();
			return false;
		}
		return true;
	}

	dispose(): void {
		this.socket?.close();
		this.closed();
	}

	open(socket: Bun.ServerWebSocket<Connection>): void {
		this.socket = socket;
		void this.registry.accept(this, "registered", this.identity);
	}

	message(
		_socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		this.dispatcher.dispatch(
			"frame",
			typeof message === "string" ? message : new Uint8Array(message),
		);
	}

	closed(): void {
		if (!this.live) {
			return;
		}
		this.live = false;
		this.dispatcher.dispatch("close");
		this.dispatcher.dispose();
	}
}
