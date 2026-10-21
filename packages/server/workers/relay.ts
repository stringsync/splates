import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Resource } from "webappwiz/disposable";
import { PortPipe } from "../ports";
import { LOOPBACK } from "../server/shared";
import { RELAY } from "./channel";
import type { WorkerSession } from "./session";

/** The most of a request's head the relay reads while looking for its secret. */
const MAX_HEAD = 16 * 1024;

/** What an unauthenticated connection to the relay is answered with. */
const REFUSED =
	"HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";

/** The bytes of a connection's first request head, held until it is read. */
interface Head {
	chunks: Uint8Array[];
	size: number;
}

/**
 * Where `splates` on a worker reaches its coordinator's server: a port on
 * the worker's loopback whose every connection goes up the worker's socket,
 * as a `relay` channel the coordinator pipes into its own server. Agents
 * find it as their `SPLATES_DEV`; `splates` run by hand, in `relay.json`.
 *
 * Other processes on the machine can reach the port too, so a connection is
 * served only when its first request carries the relay's secret: `splates`
 * sends its `SPLATES_DEV` as the `origin` header, and the secret is that
 * URL's password. A connection is as trusted as its first request.
 */
export class WorkerRelay implements Resource {
	private constructor(
		private readonly listener: Bun.TCPSocketListener<PortPipe | undefined>,
		private readonly secret: string,
	) {}

	/**
	 * Listens on any free loopback port. A connection made while the
	 * coordinator cannot take one, since it has not joined or speaks no
	 * relay, is closed at once.
	 */
	static listen(session: WorkerSession): WorkerRelay {
		const secret = randomBytes(24).toString("hex");
		const heads = new WeakMap<Bun.Socket<PortPipe | undefined>, Head>();
		return new WorkerRelay(
			Bun.listen<PortPipe | undefined>({
				hostname: LOOPBACK,
				port: 0,
				data: undefined,
				socket: {
					open: (socket) => {
						heads.set(socket, { chunks: [], size: 0 });
						if (!relays(session)) {
							socket.end();
						}
					},
					data: (socket, chunk) => {
						if (socket.data !== undefined) {
							socket.data.received(chunk);
							return;
						}
						const held = heads.get(socket);
						if (held === undefined) {
							return;
						}
						held.chunks.push(chunk);
						held.size += chunk.byteLength;
						const head = Buffer.concat(held.chunks);
						const end = head.indexOf("\r\n\r\n");
						if (end < 0 && held.size <= MAX_HEAD) {
							return;
						}
						heads.delete(socket);
						if (
							end < 0 ||
							!hasSecret(head.subarray(0, end).toString("latin1"), secret)
						) {
							socket.write(REFUSED);
							socket.end();
							return;
						}
						socket.data = new PortPipe(session.open(RELAY, {}), session);
						socket.data.attach(socket);
						socket.data.received(head);
					},
					drain: (socket) => socket.data?.flush(),
					close: (socket) => socket.data?.closed(),
					error: (socket) => socket.data?.closed(),
				},
			}),
			secret,
		);
	}

	/** What a `splates` on this machine reaches the coordinator's server by. */
	get url(): string {
		return `http://splates:${this.secret}@${LOOPBACK}:${this.listener.port}`;
	}

	dispose(): void {
		this.listener.stop(true);
	}
}

/** Whether `session`'s coordinator takes relayed connections. */
export function relays(session: WorkerSession): boolean {
	const negotiated = session.negotiated;
	return negotiated?.ok === true && negotiated.capabilities.includes(RELAY);
}

/** Whether a request head's `origin` header carries `secret` as its URL's password. */
export function hasSecret(head: string, secret: string): boolean {
	for (const line of head.split("\r\n").slice(1)) {
		const colon = line.indexOf(":");
		if (colon < 0 || line.slice(0, colon).trim().toLowerCase() !== "origin") {
			continue;
		}
		let given: string;
		try {
			given = new URL(line.slice(colon + 1).trim()).password;
		} catch {
			return false;
		}
		const theirs = Buffer.from(given);
		const ours = Buffer.from(secret);
		return theirs.length === ours.length && timingSafeEqual(theirs, ours);
	}
	return false;
}
