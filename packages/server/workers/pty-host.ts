import type { Resource } from "webappwiz/disposable";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { Pty } from "../terminal";
import type { WorkerChannel } from "./channel";
import type { WorkerSession } from "./session";

/** What a server opens a `pty` channel with. */
export const PtyParams = z.object({
	argv: z.array(z.string()).min(1),
	cwd: z.string(),
	cols: z.number().int().min(1),
	rows: z.number().int().min(1),
	env: z.record(z.string(), z.string()).default({}),
});

const PtyMessage = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("resize"),
		cols: z.number().int().min(1),
		rows: z.number().int().min(1),
	}),
	z.object({ type: z.literal("describe") }),
]);

/** How much of what the shell last wrote is kept, to redraw a terminal that comes back. */
export const SCREEN_BYTES = 64 * 1024;

/**
 * One shell a `pty` channel started on the worker, for a page's terminal:
 * the terminal's bytes both ways, a resize as a message, and its pid and
 * exit code as messages back. It keeps the last `SCREEN_BYTES` the shell
 * wrote, and says its pid and writes them again when asked to `describe`
 * itself, for a terminal taken back after a server restart, or a page
 * come back to it. Closing the channel hangs it up.
 */
export class WorkerPtyHost implements Resource {
	private readonly pty: Pty;
	/** What the shell last wrote, oldest first, `SCREEN_BYTES` at most in all. */
	private readonly screen: Uint8Array[] = [];
	private screenBytes = 0;

	constructor(
		readonly channel: WorkerChannel,
		session: Pick<WorkerSession, "drained">,
		ps: Ps,
	) {
		this.pty = new Pty({ ...PtyParams.parse(channel.params), ps });
		channel.send({ type: "started", pid: this.pty.pid });
		this.pty.events.on("data", (bytes) => {
			this.keep(bytes);
			// Past the session's bound the shell waits on a full pipe, as a
			// process does, rather than the replay growing through an outage.
			if (!channel.write(bytes)) {
				this.pty.hold(session.drained());
			}
		});
		this.pty.events.on("exit", (code) => {
			if (!channel.closed) {
				channel.send({ type: "exit", code });
				channel.dispose();
			}
		});
		channel.events.on("data", ({ bytes }) => this.pty.write(bytes));
		channel.events.on("message", ({ body }) => {
			const parsed = PtyMessage.safeParse(body);
			if (!parsed.success) {
				return;
			}
			if (parsed.data.type === "resize") {
				this.pty.resize(parsed.data.cols, parsed.data.rows);
			} else {
				this.describe();
			}
		});
		channel.events.on("close", () => this.dispose());
	}

	/** Says the pid again, then writes the screen kept, to redraw a terminal that came back. */
	private describe(): void {
		if (this.channel.closed) {
			return;
		}
		this.channel.send({ type: "started", pid: this.pty.pid });
		if (this.screenBytes > 0) {
			const all = new Uint8Array(this.screenBytes);
			let at = 0;
			for (const chunk of this.screen) {
				all.set(chunk, at);
				at += chunk.length;
			}
			this.channel.write(all);
		}
	}

	private keep(bytes: Uint8Array): void {
		this.screen.push(bytes);
		this.screenBytes += bytes.length;
		while (this.screenBytes > SCREEN_BYTES && this.screen.length > 1) {
			const dropped = this.screen.shift();
			this.screenBytes -= dropped?.length ?? 0;
		}
	}

	dispose(): void {
		void this.pty.disposeAsync();
	}
}
