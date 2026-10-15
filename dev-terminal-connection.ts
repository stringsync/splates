import { z } from "zod";
import { json } from "./dev-http";
import type { Connection } from "./dev-sockets";
import { Pty } from "./pty";

/** Bigger than any screen, and small enough that a typo cannot hurt. */
export const MAX_SIZE = 1000;

/** The one thing a page says to its terminal that is not typing. */
const TerminalMessage = z.object({
	type: z.literal("resize"),
	cols: z.number().int().min(1).max(MAX_SIZE),
	rows: z.number().int().min(1).max(MAX_SIZE),
});

/**
 * One terminal's socket: bytes both ways are the shell's own; text is for
 * what is not, as JSON: a resize from the page, the shell's exit code from
 * here.
 */
export class TerminalConnection implements Connection {
	private pty: Pty | null = null;

	constructor(
		/** Every shell open, which this one joins while it runs. */
		private readonly shells: Set<Pty>,
		private readonly argv: string[],
		private readonly cwd: string,
		private readonly cols: number,
		private readonly rows: number,
	) {}

	open(socket: Bun.ServerWebSocket<Connection>): void {
		const pty = new Pty({
			argv: this.argv,
			cwd: this.cwd,
			cols: this.cols,
			rows: this.rows,
		});
		this.pty = pty;
		this.shells.add(pty);
		pty.events.on("data", (bytes) => socket.sendBinary(bytes));
		pty.events.on("exit", (code) => {
			socket.send(JSON.stringify({ type: "exit", code }));
			socket.close();
		});
	}

	message(
		_socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		if (this.pty === null) {
			return;
		}
		if (typeof message !== "string") {
			this.pty.write(message);
			return;
		}
		const parsed = TerminalMessage.safeParse(json(message));
		if (parsed.success) {
			this.pty.resize(parsed.data.cols, parsed.data.rows);
		}
	}

	closed(): void {
		if (this.pty !== null) {
			this.shells.delete(this.pty);
			void this.pty.disposeAsync();
		}
	}
}
