import type { AsyncResource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { z } from "zod";
import type { ProcessHandle } from "./agent-process";
import type { PtyEvents } from "./pty";
import type { WorkerChannel } from "./worker-channel";

const Said = z.discriminatedUnion("type", [
	z.object({ type: z.literal("started"), pid: z.number() }),
	z.object({ type: z.literal("exit"), code: z.number() }),
	z.object({ type: z.literal("failed"), reason: z.string() }),
]);

/**
 * A shell on a worker's pseudo-terminal, seen from the coordinator as a
 * `Pty` is: what it writes arrives as `data`, and `write` is typing at it.
 * Its pid is null until the worker says it started, or says it again when
 * asked to `describe` itself, as one taken back after a restart is.
 */
export class RemotePty implements AsyncResource, Eventful<PtyEvents> {
	private readonly dispatcher = new Dispatcher<PtyEvents>();
	readonly events = this.dispatcher.events;
	/** What takes it back after a coordinator restart. */
	readonly handle: ProcessHandle;
	private _pid: number | null = null;
	private exited = false;

	constructor(
		private readonly channel: WorkerChannel,
		worker: string,
	) {
		this.handle = { worker, channel: channel.id };
		// What a shell says goes to the page as it comes, so it is held once heard.
		channel.events.on("data", ({ bytes, seq }) => {
			channel.ack(seq);
			this.dispatcher.dispatch("data", bytes);
		});
		channel.events.on("message", ({ body, seq }) => {
			channel.ack(seq);
			const said = Said.safeParse(body);
			if (!said.success) {
				return;
			}
			if (said.data.type === "started") {
				this._pid = said.data.pid;
			} else {
				this.exit(said.data.type === "exit" ? said.data.code : 127);
			}
		});
		channel.events.on("close", () => this.exit(127));
	}

	get pid(): number | null {
		return this._pid;
	}

	write(data: string | Uint8Array): void {
		if (!this.channel.closed) {
			this.channel.write(
				typeof data === "string" ? new TextEncoder().encode(data) : data,
			);
		}
	}

	resize(cols: number, rows: number): void {
		if (!this.channel.closed) {
			this.channel.send({ type: "resize", cols, rows });
		}
	}

	/** Asks the worker to say the pid again and write the screen it kept, as `data`. */
	describe(): void {
		if (!this.channel.closed) {
			this.channel.send({ type: "describe" });
		}
	}

	/** Hangs up, as closing a terminal window does. */
	async disposeAsync(): Promise<void> {
		this.channel.dispose();
	}

	private exit(code: number): void {
		if (!this.exited) {
			this.exited = true;
			this.dispatcher.dispatch("exit", code);
		}
	}
}
