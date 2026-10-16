import type { Resource } from "webappwiz/disposable";
import type { WorkerChannel } from "./worker-channel";
import type { WorkerSession } from "./worker-session";

/**
 * Bun's TCP socket, whose handlers hand each event to the `PortPipe` it
 * carries: none yet on one a listener just took in, until its `open` makes one.
 */
export type PipedSocket = Bun.Socket<PortPipe | undefined>;

/** The handlers `Bun.connect` and `Bun.listen` take for a piped socket. */
export const PIPE_HANDLERS: Bun.SocketHandler<PortPipe | undefined> = {
	open: (socket) => socket.data?.attach(socket),
	data: (socket, chunk) => socket.data?.received(chunk),
	drain: (socket) => socket.data?.flush(),
	close: (socket) => socket.data?.closed(),
	error: (socket) => socket.data?.closed(),
};

/**
 * One TCP connection carried over a `port` channel, the same at both ends: at
 * the worker, to the task's port; at the coordinator, from whoever opened its
 * forward. Bytes go both ways as the channel's data, the socket stops reading
 * while the session is full, and either end closing closes the other.
 */
export class PortPipe implements Resource {
	private socket: PipedSocket | null = null;
	/** What the kernel would not take yet, sent on the next drain. */
	private unsent: Uint8Array[] = [];
	/** The channel closed, so the socket ends once `unsent` is out. */
	private ending = false;
	private done = false;

	constructor(
		private readonly channel: WorkerChannel,
		private readonly session: WorkerSession,
	) {
		channel.events.on("data", ({ bytes }) => {
			this.unsent.push(bytes);
			this.flush();
		});
		channel.events.on("close", () => {
			this.ending = true;
			this.flush();
		});
	}

	/** Takes the socket it pipes, once it is open. */
	attach(socket: PipedSocket): void {
		this.socket = socket;
		this.flush();
	}

	/** Bun's `data` handler calls this with each chunk it read. */
	received(chunk: Uint8Array): void {
		if (this.channel.closed) {
			return;
		}
		if (!this.channel.write(chunk)) {
			const socket = this.socket;
			socket?.pause();
			void this.session.drained().then(() => socket?.resume());
		}
	}

	/** Sends what the kernel has room for now, and ends once all is out. */
	flush(): void {
		const socket = this.socket;
		while (socket !== null && this.unsent.length > 0) {
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
		if (this.ending && socket !== null && !this.done) {
			this.done = true;
			socket.end();
		}
	}

	/** The socket closed, from either end: so does the channel. */
	closed(): void {
		this.done = true;
		this.socket = null;
		if (!this.channel.closed) {
			this.channel.dispose();
		}
	}

	dispose(): void {
		if (!this.channel.closed) {
			this.channel.dispose();
		}
		this.ending = true;
		this.flush();
	}
}
