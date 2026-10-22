import type { Resource } from "webappwiz/disposable";
import { z } from "zod";
import { PIPE_HANDLERS, PortPipe } from "../ports";
import type { WorkerChannel } from "./channel";
import type { RelayScopes } from "./relay-scopes";
import type { WorkerSession } from "./session";

/** What a server opens a `port` channel with. */
export const PortParams = z.object({
	port: z.number().int().min(1).max(65_535),
});

/**
 * Where a task's server is reached on its worker: IPv4 loopback first, then
 * IPv6, since a dev server asked for `localhost` may bind only `::1`.
 */
const LOOPBACKS = ["127.0.0.1", "::1"];

/**
 * One TCP connection a `port` channel opened to a port on the worker's
 * loopback, such as a task's dev server: its bytes both ways as the
 * channel's, `connected` once it is open, or `failed` with why before the
 * channel closes. Closing the channel ends the connection.
 */
export class WorkerPortHost implements Resource {
	private readonly pipe: PortPipe;
	private held: Resource | null = null;

	constructor(
		private readonly channel: WorkerChannel,
		session: WorkerSession,
		/**
		 * The port to connect to, where it is this end's to say rather than
		 * the channel's, as for a worker's relay into the server.
		 */
		port: number = PortParams.parse(channel.params).port,
		/** Who the connection is limited to, for a relayed one made by an agent. */
		private readonly scope: {
			scopes: RelayScopes;
			project: string;
		} | null = null,
	) {
		this.pipe = new PortPipe(channel, session);
		void this.connect(port);
	}

	dispose(): void {
		this.held?.dispose();
		this.pipe.dispose();
	}

	private async connect(port: number): Promise<void> {
		let refused = "";
		for (const hostname of LOOPBACKS) {
			try {
				const socket = await Bun.connect<PortPipe | undefined>({
					hostname,
					port,
					socket: PIPE_HANDLERS,
					data: this.pipe,
				});
				if (this.scope !== null) {
					this.held = this.scope.scopes.hold(
						socket.localPort,
						this.scope.project,
					);
				}
				if (!this.channel.closed) {
					this.channel.send({ type: "connected" });
				}
				return;
			} catch (error) {
				refused = error instanceof Error ? error.message : String(error);
			}
		}
		if (!this.channel.closed) {
			this.channel.send({
				type: "failed",
				reason: `nothing answers on port ${port}: ${refused}`,
			});
			this.channel.dispose();
		}
	}
}
