import type { Connection } from "./dev-sockets";

/** How long a task's server has to take a WebSocket before it is refused. */
const OPEN_MS = 10_000;

/**
 * A page's WebSocket to a task's server, such as a dev server's hot reload,
 * carried on to that server: each message as it came, both ways, and a
 * close at either end closes the other. The server's end opens first, so the
 * page's upgrade can answer with the subprotocol the server chose.
 */
export class PortSocket implements Connection {
	private socket: Bun.ServerWebSocket<Connection> | null = null;
	/** What the task's server said before the page's end opened. */
	private early: (string | Uint8Array)[] = [];

	private constructor(private readonly upstream: WebSocket) {
		upstream.binaryType = "arraybuffer";
		upstream.addEventListener("message", ({ data }) => {
			const message =
				typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer);
			if (this.socket === null) {
				this.early.push(message);
			} else {
				this.socket.send(message);
			}
		});
		upstream.addEventListener("close", ({ code, reason }) =>
			this.socket?.close(closable(code), reason),
		);
	}

	/**
	 * Opens a WebSocket to `url` with the page's `headers` and subprotocols,
	 * or says why it could not.
	 */
	static async open(
		url: string,
		headers: Headers,
		protocols: string[],
	): Promise<PortSocket | { refused: string }> {
		// Bun's own options; the DOM's types know only the subprotocols.
		const options: Bun.WebSocketOptions = {
			headers: Object.fromEntries(headers),
			protocols,
		};
		const upstream = new WebSocket(url, options as string[]);
		const opened = await new Promise<string | null>((resolve) => {
			const timeout = setTimeout(() => {
				upstream.close();
				resolve("it did not answer in time");
			}, OPEN_MS);
			upstream.addEventListener("open", () => {
				clearTimeout(timeout);
				resolve(null);
			});
			upstream.addEventListener("error", () => {
				clearTimeout(timeout);
				resolve("it refused the WebSocket");
			});
		});
		return opened === null ? new PortSocket(upstream) : { refused: opened };
	}

	/** The subprotocol the task's server chose, for the page's upgrade to answer with. */
	get protocol(): string {
		return this.upstream.protocol;
	}

	open(socket: Bun.ServerWebSocket<Connection>): void {
		this.socket = socket;
		for (const message of this.early) {
			socket.send(message);
		}
		this.early = [];
		if (this.upstream.readyState >= WebSocket.CLOSING) {
			socket.close();
		}
	}

	message(
		_socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		if (this.upstream.readyState === WebSocket.OPEN) {
			this.upstream.send(message);
		}
	}

	closed(): void {
		this.upstream.close();
	}
}

/** A code a close may carry on: 1005, 1006 and 1015 are never sent, only reported. */
function closable(code: number): number | undefined {
	return [1005, 1006, 1015].includes(code) ? undefined : code;
}
