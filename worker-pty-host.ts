import type { Resource } from "webappwiz/disposable";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { Pty } from "./pty";
import type { WorkerChannel } from "./worker-channel";

/** What a coordinator opens a `pty` channel with. */
export const PtyParams = z.object({
	argv: z.array(z.string()).min(1),
	cwd: z.string(),
	cols: z.number().int().min(1),
	rows: z.number().int().min(1),
	env: z.record(z.string(), z.string()).default({}),
});

const PtyMessage = z.object({
	type: z.literal("resize"),
	cols: z.number().int().min(1),
	rows: z.number().int().min(1),
});

/**
 * One shell a `pty` channel started on the worker, for a page's terminal:
 * the terminal's bytes both ways, a resize as a message, and its pid and
 * exit code as messages back. Closing the channel hangs it up.
 */
export class WorkerPtyHost implements Resource {
	private readonly pty: Pty;

	constructor(
		readonly channel: WorkerChannel,
		ps: Ps,
	) {
		this.pty = new Pty({ ...PtyParams.parse(channel.params), ps });
		channel.send({ type: "started", pid: this.pty.pid });
		// A terminal is typed at, so its output comes at a human pace, and a
		// `Pty` cannot pause: what it says is kept even past the session's bound.
		this.pty.events.on("data", (bytes) => channel.write(bytes));
		this.pty.events.on("exit", (code) => {
			if (!channel.closed) {
				channel.send({ type: "exit", code });
				channel.dispose();
			}
		});
		channel.events.on("data", ({ bytes }) => this.pty.write(bytes));
		channel.events.on("message", ({ body }) => {
			const parsed = PtyMessage.safeParse(body);
			if (parsed.success) {
				this.pty.resize(parsed.data.cols, parsed.data.rows);
			}
		});
		channel.events.on("close", () => this.dispose());
	}

	dispose(): void {
		void this.pty.disposeAsync();
	}
}
