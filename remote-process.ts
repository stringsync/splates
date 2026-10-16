import { z } from "zod";
import type { AgentProcess } from "./agent-process";
import type { WorkerChannel } from "./worker-channel";
import type { WorkerSession } from "./worker-session";

/** What a worker says on a process's channel besides its stdout. */
const Said = z.discriminatedUnion("type", [
	z.object({ type: z.literal("started"), pid: z.number().nullable() }),
	z.object({ type: z.literal("stderr"), text: z.string() }),
	z.object({ type: z.literal("exit"), code: z.number() }),
	z.object({ type: z.literal("failed"), reason: z.string() }),
]);

/** How much of stderr is kept to explain how a process died, as for a local one. */
const STDERR_CHARS = 2_000;

/**
 * A process running on a worker, seen from the coordinator as any
 * `AgentProcess` is: writing `input` is its stdin, `output` its stdout. Its
 * pid is null until the worker says it started.
 */
export class RemoteProcess implements AgentProcess {
	readonly input: WritableStream<Uint8Array>;
	readonly output: ReadableStream<Uint8Array>;
	readonly exited: Promise<number>;
	private _pid: number | null = null;
	private tail = "";

	constructor(
		private readonly channel: WorkerChannel,
		session: WorkerSession,
	) {
		const exit = Promise.withResolvers<number>();
		this.exited = exit.promise;
		let stdout: ReadableStreamDefaultController<Uint8Array> | undefined;
		this.output = new ReadableStream<Uint8Array>({
			start: (controller) => {
				stdout = controller;
			},
			cancel: () => this.kill(),
		});
		this.input = new WritableStream<Uint8Array>({
			write: async (bytes) => {
				if (!channel.closed && !channel.write(bytes)) {
					await session.drained();
				}
			},
			close: () => {
				if (!channel.closed) {
					channel.send({ type: "end" });
				}
			},
		});
		channel.events.on("data", ({ bytes }) => stdout?.enqueue(bytes));
		channel.events.on("message", ({ body }) => {
			const said = Said.safeParse(body);
			if (!said.success) {
				return;
			}
			const { data } = said;
			if (data.type === "started") {
				this._pid = data.pid;
			} else if (data.type === "stderr") {
				this.tail = (this.tail + data.text).slice(-STDERR_CHARS);
			} else if (data.type === "exit") {
				exit.resolve(data.code);
			} else {
				this.tail = data.reason;
				exit.resolve(127);
			}
		});
		// Its exit comes before its close; a close alone means it never said.
		channel.events.on("close", () => {
			stdout?.close();
			exit.resolve(127);
		});
	}

	get pid(): number | null {
		return this._pid;
	}

	stderr(): string {
		return this.tail;
	}

	kill(): void {
		if (!this.channel.closed) {
			this.channel.send({ type: "kill" });
		}
	}
}
