import type { Shell } from "./dev-shell";
import type { Connection } from "./dev-sockets";

/**
 * One terminal's socket, which shows a `Shell`: bytes both ways are the
 * shell's own; text is for what is not, as JSON: a resize or a question
 * from the page, the shell's exit code and the job in front, null at a
 * prompt, from here.
 */
export class TerminalConnection implements Connection {
	constructor(
		private readonly shell: Shell,
		/** Whether the page comes back to a shell it had, which redraws for it. */
		private readonly back: boolean,
	) {}

	open(socket: Bun.ServerWebSocket<Connection>): void {
		this.shell.attach(socket, this.back);
	}

	message(
		socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		this.shell.message(socket, message);
	}

	closed(socket: Bun.ServerWebSocket<Connection>): void {
		this.shell.detach(socket);
	}
}
