import type { Ps, TerminalChild } from "webappwiz/system";
import type { Connection } from "./dev-sockets";

/** Releases the single native setup slot when its command ends. */
export interface NativeSetupOwner {
	finished(): void;
}

/** A single ephemeral native command. Input/output are never persisted or logged. */
export class NativeSetupConnection implements Connection {
	private child: TerminalChild | null = null;
	private socket: Bun.ServerWebSocket<Connection> | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	constructor(
		private readonly ps: Ps,
		private readonly argv: string[],
		private readonly cwd: string,
		private readonly owner: NativeSetupOwner,
	) {}

	open(socket: Bun.ServerWebSocket<Connection>): void {
		this.socket = socket;
		try {
			const child = this.ps.startOnTerminal([...this.argv], {
				cwd: this.cwd,
				cols: 80,
				rows: 18,
				env: { TERM: "xterm-256color" },
			});
			this.child = child;
			void (async () => {
				for await (const bytes of child.output) {
					if (!this.disposed) {
						socket.sendBinary(bytes);
					}
				}
			})().catch(() => this.finish(1));
			void child.exited.then(
				(code) => this.finish(code),
				() => this.finish(1),
			);
			this.timer = setTimeout(() => this.finish(124), 10 * 60_000);
		} catch {
			this.finish(127);
		}
	}

	message(
		_socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		if (this.disposed) {
			return;
		}
		if (typeof message !== "string") {
			this.child?.write(message);
			return;
		}
		try {
			const control = JSON.parse(message);
			if (control.type === "close") {
				this.dispose();
			}
			if (
				control.type === "resize" &&
				Number.isInteger(control.cols) &&
				Number.isInteger(control.rows) &&
				control.cols > 0 &&
				control.cols <= 1000 &&
				control.rows > 0 &&
				control.rows <= 1000
			) {
				this.child?.resize(control.cols, control.rows);
			}
		} catch {
			/* Invalid control messages carry no diagnostic output. */
		}
	}
	closed(): void {
		this.dispose();
	}
	private finish(code: number): void {
		if (!this.disposed) {
			this.socket?.send(JSON.stringify({ type: "exit", code }));
		}
		this.dispose();
	}
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		clearTimeout(this.timer);
		this.child?.kill("SIGHUP");
		this.child?.close();
		this.socket?.close();
		this.owner.finished();
	}
}
