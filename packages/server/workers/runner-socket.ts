import { Dispatcher } from "webappwiz/events";
import type { WorkerSocket, WorkerSocketEvents } from "./socket";

/** Adapts an incoming runner connection to the existing job channel protocol. */
export class RunnerSocket implements WorkerSocket {
	private readonly dispatcher = new Dispatcher<WorkerSocketEvents>();
	readonly events = this.dispatcher.events;
	private live = true;

	constructor(private readonly socket: Bun.ServerWebSocket<unknown>) {}

	send(frame: string | Uint8Array): boolean {
		if (!this.live) {
			return false;
		}
		if (this.socket.send(frame) === 0) {
			this.dispose();
			return false;
		}
		return true;
	}

	message(frame: string | Buffer): void {
		this.dispatcher.dispatch(
			"frame",
			typeof frame === "string" ? frame : new Uint8Array(frame),
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

	dispose(): void {
		this.socket.close();
		this.closed();
	}
}
