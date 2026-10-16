import { Dispatcher } from "webappwiz/events";
import type { Connection } from "./dev-sockets";
import type { WorkerRegistry } from "./worker-registry";
import type { WorkerSocket, WorkerSocketEvents } from "./worker-socket";

/**
 * A worker's WebSocket as `arbor dev` upgraded it on `/api/workers`, seen as
 * a `WorkerSocket`: the server hands it each socket event, and it hands
 * itself to the registry once open.
 */
export class ServerWorkerSocket implements WorkerSocket, Connection {
	private readonly dispatcher = new Dispatcher<WorkerSocketEvents>();
	readonly events = this.dispatcher.events;
	private socket: Bun.ServerWebSocket<Connection> | undefined;
	private live = true;

	constructor(private readonly registry: WorkerRegistry) {}

	send(frame: string | Uint8Array): void {
		if (!this.live || !this.socket) {
			return;
		}
		if (typeof frame === "string") {
			this.socket.send(frame);
		} else {
			this.socket.sendBinary(frame);
		}
	}

	dispose(): void {
		this.socket?.close();
		this.closed();
	}

	open(socket: Bun.ServerWebSocket<Connection>): void {
		this.socket = socket;
		void this.registry.accept(this);
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
