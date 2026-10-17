import { z } from "zod";
import type { AgentFrame, AgentProcess, ProcessHandle } from "./agent-process";
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
 * `AgentProcess` is: writing `input` is its stdin, `output` its stdout, each
 * frame in the seq its channel gave it, acked back to the worker once written
 * down. Its pid is null until the worker says it started; one taken back
 * after a restart asks again, since the word came before.
 */
export class RemoteProcess implements AgentProcess {
	readonly input: WritableStream<Uint8Array>;
	readonly output: ReadableStream<AgentFrame>;
	readonly exited: Promise<number>;
	readonly handle: ProcessHandle;
	private _pid: number | null = null;
	private tail = "";

	constructor(
		private readonly channel: WorkerChannel,
		session: WorkerSession,
		worker: string,
		{ resumed = false }: { resumed?: boolean } = {},
	) {
		this.handle = { worker, channel: channel.id };
		const exit = Promise.withResolvers<number>();
		this.exited = exit.promise;
		let stdout: ReadableStreamDefaultController<AgentFrame> | undefined;
		this.output = new ReadableStream<AgentFrame>({
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
		channel.events.on("data", (frame) => stdout?.enqueue(frame));
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
		// Its exit comes before its close; a close alone means it never said,
		// as when the worker no longer holds it.
		channel.events.on("close", () => {
			stdout?.close();
			this.tail ||= "the worker no longer runs it";
			exit.resolve(127);
		});
		if (resumed) {
			// Sent once the handshake has said where this end's seqs carry on
			// from, since a frame numbered before that the worker drops.
			const describe = () => {
				if (!channel.closed) {
					channel.send({ type: "describe" });
				}
			};
			if (session.connected) {
				describe();
			} else {
				session.events.on("connected", describe, { once: true });
			}
		}
	}

	get pid(): number | null {
		return this._pid;
	}

	stderr(): string {
		return this.tail;
	}

	ack(seq: number): void {
		this.channel.ack(seq);
	}

	kill(): void {
		if (!this.channel.closed) {
			this.channel.send({ type: "kill" });
		}
	}
}
