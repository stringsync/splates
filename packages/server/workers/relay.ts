import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Resource } from "webappwiz/disposable";
import { PortPipe } from "../ports";
import { LOOPBACK } from "../server/shared";
import { RELAY, type RelayParams } from "./channel";
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
 * Where `splates` on a worker reaches its server: a port on
 * the worker's loopback whose every connection goes up the worker's socket,
 * as a `relay` channel the server pipes into its own listener. Agents
 * find it as their `SPLATES_DEV`; `splates` run by hand, in `relay.json`.
 *
 * Other processes on the machine can reach the port too, so a connection is
 * served only when its first request carries the relay's secret: `splates`
 * sends its `SPLATES_DEV` as the `origin` header, and the secret is that
 * URL's password. A connection is as trusted as its first request.
 *
 * The relay's own secret, in `url`, is for `splates` run by hand, and
 * reaches whatever the server does. Each agent a worker runs
 * gets a secret of its own from `issue`, which the server is told the
 * project of with every connection made by it, so the agent reaches that
 * project's records alone and a secret it was never handed gets nowhere.
 */
export class WorkerRelay implements Resource {
	private constructor(
		private readonly listener: Bun.TCPSocketListener<PortPipe | undefined>,
		private readonly secret: string,
		private readonly scopes: Map<string, string>,
	) {}

	/**
	 * Listens on any free loopback port. A connection made while the
	 * server cannot take one, since it has not joined or speaks no
	 * relay, is closed at once.
	 */
	static listen(session: WorkerSession): WorkerRelay {
		const secret = randomBytes(24).toString("hex");
		// Each agent's secret, and the project it is limited to.
		const scopes = new Map<string, string>();
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
						const given =
							end < 0
								? null
								: secretIn(head.subarray(0, end).toString("latin1"));
						const scope = given === null ? undefined : scopeOf(given);
						if (given === null || scope === undefined) {
							socket.write(REFUSED);
							socket.end();
							return;
						}
						const params: RelayParams =
							scope === null ? {} : { project: scope };
						socket.data = new PortPipe(session.open(RELAY, params), session);
						socket.data.attach(socket);
						socket.data.received(head);
					},
					drain: (socket) => socket.data?.flush(),
					close: (socket) => socket.data?.closed(),
					error: (socket) => socket.data?.closed(),
				},
			}),
			secret,
			scopes,
		);

		/** The project `given` is limited to, null for the relay's own secret, undefined for none. */
		function scopeOf(given: string): string | null | undefined {
			if (same(given, secret)) {
				return null;
			}
			for (const [each, project] of scopes) {
				if (same(given, each)) {
					return project;
				}
			}
			return undefined;
		}
	}

	/**
	 * A relay URL for one agent, limited to `project`'s records, good until
	 * disposed (when the agent ends).
	 */
	issue(project: string): { url: string } & Resource {
		const secret = randomBytes(24).toString("hex");
		this.scopes.set(secret, project);
		return {
			url: this.urlWith(secret),
			dispose: () => {
				this.scopes.delete(secret);
			},
		};
	}

	/** What a `splates` on this machine reaches the server by. */
	get url(): string {
		return this.urlWith(this.secret);
	}

	private urlWith(secret: string): string {
		return `http://splates:${secret}@${LOOPBACK}:${this.listener.port}`;
	}

	dispose(): void {
		this.listener.stop(true);
	}
}

/** Whether `session`'s server takes relayed connections. */
export function relays(session: WorkerSession): boolean {
	const negotiated = session.negotiated;
	return negotiated?.ok === true && negotiated.capabilities.includes(RELAY);
}

/** Whether two secrets are the same, without telling how much of one was right. */
function same(given: string, secret: string): boolean {
	const theirs = Buffer.from(given);
	const ours = Buffer.from(secret);
	return theirs.length === ours.length && timingSafeEqual(theirs, ours);
}

/** The password of a request head's `origin` header, which `splates` sends its `SPLATES_DEV` as; null when it has none. */
export function secretIn(head: string): string | null {
	for (const line of head.split("\r\n").slice(1)) {
		const colon = line.indexOf(":");
		if (colon < 0 || line.slice(0, colon).trim().toLowerCase() !== "origin") {
			continue;
		}
		try {
			return new URL(line.slice(colon + 1).trim()).password || null;
		} catch {
			return null;
		}
	}
	return null;
}

/** Whether a request head's `origin` header carries `secret` as its URL's password. */
export function hasSecret(head: string, secret: string): boolean {
	const given = secretIn(head);
	return given !== null && same(given, secret);
}
