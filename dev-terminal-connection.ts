import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { json } from "./dev-http";
import type { Connection } from "./dev-sockets";
import { heldBy } from "./held";
import { Pty } from "./pty";

/** Bigger than any screen, and small enough that a typo cannot hurt. */
export const MAX_SIZE = 1000;

/**
 * What a page says to its terminal that is not typing: a resize, or asking
 * what job the shell runs in front, as it does before closing it.
 */
const TerminalMessage = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("resize"),
		cols: z.number().int().min(1).max(MAX_SIZE),
		rows: z.number().int().min(1).max(MAX_SIZE),
	}),
	z.object({ type: z.literal("front") }),
]);

/**
 * One terminal's socket: bytes both ways are the shell's own; text is for
 * what is not, as JSON: a resize or a question from the page, the shell's
 * exit code and the job in front, null at a prompt, from here.
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
		/** Where the job in front of the shell is read from. */
		private readonly ps: Ps,
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
		socket: Bun.ServerWebSocket<Connection>,
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
		if (!parsed.success) {
			return;
		}
		if (parsed.data.type === "resize") {
			this.pty.resize(parsed.data.cols, parsed.data.rows);
		} else {
			void this.front(this.pty, socket);
		}
	}

	/** Tells the page what `pty`'s shell runs in front, or null at its prompt. */
	private async front(
		pty: Pty,
		socket: Bun.ServerWebSocket<Connection>,
	): Promise<void> {
		const [held] = heldBy(await this.ps.processes(), {
			shells: [pty.pid],
			agents: [],
		});
		socket.send(
			JSON.stringify({ type: "front", command: held?.command ?? null }),
		);
	}

	closed(): void {
		if (this.pty !== null) {
			this.shells.delete(this.pty);
			void this.pty.disposeAsync();
		}
	}
}
