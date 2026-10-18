import { Dispatcher } from "webappwiz/events";
import type { WorkerSocket, WorkerSocketEvents } from "./worker-socket";

/** Bun's socket, whose handlers hand each event to the `UnixWorkerSocket` it carries. */
export type UnixSocket = Bun.Socket<UnixWorkerSocket>;

/** The handlers `Bun.listen` and `Bun.connect` take, the same at both ends. */
export const UNIX_HANDLERS: Bun.SocketHandler<UnixWorkerSocket> = {
	data: (socket, chunk) => socket.data.received(chunk),
	drain: (socket) => socket.data.flush(),
	close: (socket) => socket.data.closed(),
	error: (socket) => socket.data.closed(),
};

/**
 * A `WorkerSocket` over a Unix socket, how the local worker speaks to the
 * coordinator on its machine. Dial one with `connect`; a `UnixWorkerListener`
 * hands over the other end.
 */
export class UnixWorkerSocket implements WorkerSocket {
	// A Unix socket carries bytes rather than messages, so each frame goes as a
	// 4-byte big-endian length, a byte saying text (0) or binary (1), then the
	// frame.
	private readonly dispatcher = new Dispatcher<WorkerSocketEvents>();
	readonly events = this.dispatcher.events;
	private socket: UnixSocket | undefined;
	private pending = new Uint8Array(0);
	/** What the kernel would not take yet, sent on the next drain. */
	private unsent: Uint8Array[] = [];
	private open = true;

	/** Dials the coordinator listening at `path`. */
	static async connect(path: string): Promise<UnixWorkerSocket> {
		const adapter = new UnixWorkerSocket();
		const socket = await Bun.connect<UnixWorkerSocket>({
			unix: path,
			socket: UNIX_HANDLERS,
			data: adapter,
		});
		adapter.attach(socket);
		return adapter;
	}

	/** Takes the Bun socket it speaks over, as a listener or `connect` hands it. */
	attach(socket: UnixSocket): void {
		this.socket = socket;
		this.flush();
	}

	send(frame: string | Uint8Array): void {
		if (!this.open) {
			return;
		}
		const body = typeof frame === "string" ? TEXT.encode(frame) : frame;
		const framed = new Uint8Array(HEADER + body.byteLength);
		new DataView(framed.buffer).setUint32(0, body.byteLength);
		framed[4] = typeof frame === "string" ? 0 : 1;
		framed.set(body, HEADER);
		this.unsent.push(framed);
		this.flush();
	}

	dispose(): void {
		if (!this.open) {
			return;
		}
		this.flush();
		this.socket?.end();
		this.closed();
	}

	/** Bun's `data` handler calls this with each chunk it read. */
	received(chunk: Uint8Array): void {
		// A chunk may hold part of a frame, or several.
		const joined = new Uint8Array(this.pending.byteLength + chunk.byteLength);
		joined.set(this.pending);
		joined.set(chunk, this.pending.byteLength);
		let at = 0;
		while (joined.byteLength - at >= HEADER) {
			const view = new DataView(joined.buffer, joined.byteOffset + at);
			const length = view.getUint32(0);
			if (joined.byteLength - at < HEADER + length) {
				break;
			}
			const body = joined.slice(at + HEADER, at + HEADER + length);
			const text = joined[at + 4] === 0;
			at += HEADER + length;
			this.dispatcher.dispatch("frame", text ? DECODE.decode(body) : body);
		}
		this.pending = joined.slice(at);
	}

	/** Sends what the kernel has room for now. */
	flush(): void {
		const socket = this.socket;
		while (socket && this.unsent.length > 0) {
			const next = this.unsent[0] as Uint8Array;
			const wrote = socket.write(next);
			if (wrote >= next.byteLength) {
				this.unsent.shift();
				continue;
			}
			if (wrote > 0) {
				this.unsent[0] = next.subarray(wrote);
			}
			return;
		}
	}

	closed(): void {
		if (!this.open) {
			return;
		}
		this.open = false;
		this.dispatcher.dispatch("close");
		this.dispatcher.dispose();
	}
}

/** Length, then whether it is text. */
const HEADER = 5;
const TEXT = new TextEncoder();
const DECODE = new TextDecoder();
