import { Dispatcher } from "webappwiz/events";
import type { WorkerSocket, WorkerSocketEvents } from "./worker-socket";

/**
 * One end of a `WorkerSocketPair`. Frames arrive on a microtask, in order, as
 * a real socket's would after the send returns.
 */
export class MemoryWorkerSocket implements WorkerSocket {
	private readonly dispatcher = new Dispatcher<WorkerSocketEvents>();
	readonly events = this.dispatcher.events;
	peer: MemoryWorkerSocket | undefined;
	private open = true;
	private cut = false;

	send(frame: string | Uint8Array): void {
		const peer = this.peer;
		if (!this.open || !peer) {
			return;
		}
		queueMicrotask(() => {
			if (!this.cut) {
				peer.dispatcher.dispatch("frame", frame);
			}
		});
	}

	/** Hangs up after what was sent arrives, as a WebSocket close does. */
	dispose(): void {
		this.hangUp(false);
	}

	/** Drops the link, losing every frame still on the way, as a network does. */
	drop(): void {
		this.hangUp(true);
	}

	private hangUp(cut: boolean): void {
		const peer = this.peer;
		if (!this.open || !peer) {
			return;
		}
		this.open = false;
		peer.open = false;
		this.cut = cut;
		peer.cut = cut;
		queueMicrotask(() => {
			this.dispatcher.dispatch("close");
			peer.dispatcher.dispatch("close");
		});
	}
}
