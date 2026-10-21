import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type Json, WorkerProtocol } from "./protocol";

/** The capability, and the channel kind, a relayed connection goes by. */
export const RELAY = "relay";

/**
 * What a worker opens a `relay` channel with: the project the agent that
 * made the connection is limited to, absent for `splates` run by hand.
 */
export type RelayParams = { project?: string };

/** Reads a relay channel's params, which a worker says. */
export function relayParams(params: unknown): RelayParams {
	const project = (params as { project?: unknown } | null)?.project;
	return typeof project === "string" ? { project } : {};
}

/** What a `WorkerChannel` hears from the other end, each with its seq. */
export interface WorkerChannelEvents extends Record<string, unknown> {
	data: { bytes: Uint8Array; seq: number };
	message: { body: Json; seq: number };
	/** Both ends have closed it, whichever closed first. */
	close: undefined;
}

/** What a channel needs of the session it runs over. */
export interface WorkerChannelLink {
	/** Sends a frame in the channel's next seq, and says whether there is room for more. */
	send(
		channel: number,
		frame:
			| { type: "message"; body: Json }
			| { type: "data"; bytes: Uint8Array }
			| { type: "close" },
	): boolean;
	ack(channel: number, seq: number): void;
	/** Both ends have said close, so the session can forget the channel. */
	done(channel: number): void;
}

/**
 * One stream between a coordinator and a worker, such as an agent's stdio or
 * a PTY: bytes as `data`, and JSON as `message` for what is not bytes (a
 * resize, an exit code). Its frames survive a reconnect. Disposing it closes
 * it at both ends, and each hears `close` once both have.
 */
export class WorkerChannel implements Eventful<WorkerChannelEvents>, Resource {
	private readonly dispatcher = new Dispatcher<WorkerChannelEvents>();
	readonly events = this.dispatcher.events;
	private sentClose = false;
	private heardClose = false;
	private _id: number;

	constructor(
		id: number,
		readonly kind: string,
		readonly params: Json,
		private readonly link: WorkerChannelLink,
	) {
		this._id = id;
	}

	/**
	 * What both ends know it by. One opened before a resumed session's
	 * handshake takes its last id then (`renumber`).
	 */
	get id(): number {
		return this._id;
	}

	/** Gives it `id` in place of the one it was opened on; the session calls it, before it sent anything. */
	renumber(id: number): void {
		this._id = id;
	}

	get closed(): boolean {
		return this.sentClose || this.heardClose;
	}

	/**
	 * Returns `false` once the session holds as many unacked bytes as it is
	 * allowed: stop reading whatever feeds this until the session's `drain`.
	 */
	write(bytes: Uint8Array): boolean {
		this.assertOpen();
		const most = WorkerProtocol.maxDataBytes;
		let room = true;
		for (let at = 0; at === 0 || at < bytes.byteLength; at += most) {
			room =
				this.link.send(this.id, {
					type: "data",
					bytes: bytes.subarray(at, at + most),
				}) && room;
		}
		return room;
	}

	/** As `write`, for JSON. */
	send(body: Json): boolean {
		this.assertOpen();
		return this.link.send(this.id, { type: "message", body });
	}

	/** Says this end holds everything up to `seq`, for a session that acks by hand. */
	ack(seq: number): void {
		this.link.ack(this.id, seq);
	}

	dispose(): void {
		if (this.sentClose) {
			return;
		}
		this.sentClose = true;
		this.link.send(this.id, { type: "close" });
		this.finishIfDone();
	}

	/**
	 * Ends it here without a word to the other end, which no longer knows it,
	 * as a coordinator started again does not; this end hears `close`.
	 */
	drop(): void {
		if (this.sentClose && this.heardClose) {
			return;
		}
		this.sentClose = true;
		this.heardClose = true;
		this.dispatcher.dispatch("close");
		this.dispatcher.dispose();
	}

	/**
	 * Hands the channel what the other end sent; the session calls it. Says
	 * whether anyone heard it, since a frame nobody heard is the session's to ack.
	 */
	receive(
		frame:
			| { type: "message"; body: Json; seq: number }
			| { type: "data"; bytes: Uint8Array; seq: number }
			| { type: "close"; seq: number },
	): boolean {
		if (frame.type === "close") {
			this.heardClose = true;
			if (!this.sentClose) {
				this.sentClose = true;
				this.link.send(this.id, { type: "close" });
			}
			this.finishIfDone();
			return false;
		}
		// What the other end sent before it heard this end close is moot.
		if (this.sentClose) {
			return false;
		}
		if (frame.type === "data") {
			this.dispatcher.dispatch("data", { bytes: frame.bytes, seq: frame.seq });
		} else {
			this.dispatcher.dispatch("message", { body: frame.body, seq: frame.seq });
		}
		return true;
	}

	private finishIfDone(): void {
		if (this.sentClose && this.heardClose) {
			this.link.done(this.id);
			this.dispatcher.dispatch("close");
			this.dispatcher.dispose();
		}
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new Error(`channel ${this.id} (${this.kind}) is closed`);
		}
	}
}
