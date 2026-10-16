import type { Resource } from "webappwiz/disposable";
import { z } from "zod";
import { PIPE_HANDLERS, PortPipe } from "./port-pipe";
import type { WorkerChannel } from "./worker-channel";
import type { WorkerSession } from "./worker-session";

/** What a coordinator opens a `port` channel with. */
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

	constructor(
		private readonly channel: WorkerChannel,
		session: WorkerSession,
	) {
		const { port } = PortParams.parse(channel.params);
		this.pipe = new PortPipe(channel, session);
		void this.connect(port);
	}

	dispose(): void {
		this.pipe.dispose();
	}

	private async connect(port: number): Promise<void> {
		let refused = "";
		for (const hostname of LOOPBACKS) {
			try {
				await Bun.connect<PortPipe | undefined>({
					hostname,
					port,
					socket: PIPE_HANDLERS,
					data: this.pipe,
				});
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
