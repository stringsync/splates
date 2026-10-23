import { Duration } from "webappwiz/time";
import { z } from "zod";
import type { AgentFrame, AgentProcess, ProcessHandle } from "../agents";
import type { WorkerChannel } from "./channel";
import type { WorkerSession } from "./session";

/** What a worker says on a process's channel besides its stdout. */
const Said = z.discriminatedUnion("type", [
	z.object({ type: z.literal("started"), pid: z.number().nullable() }),
	z.object({ type: z.literal("stderr"), text: z.string() }),
	z.object({ type: z.literal("exit"), code: z.number() }),
	z.object({ type: z.literal("failed"), reason: z.string() }),
]);

/** How long a worker has to say anything of a process taken back, once it rejoins. */
export const ANSWER_WITHIN = Duration.mins(1);

/** How much of stderr is kept to explain how a process died, as for a local one. */
const STDERR_CHARS = 2_000;

/**
 * A process running on a worker, seen from the server as any
 * `AgentProcess` is: writing `input` is its stdin, `output` its stdout, each
 * frame in the seq its channel gave it, acked back to the worker once written
 * down. Its pid is null until the worker says it started; one taken back
 * after a restart asks again, since the word came before.
 */
export class WorkerProcess implements AgentProcess {
	readonly input: WritableStream<Uint8Array>;
	readonly output: ReadableStream<AgentFrame>;
	readonly exited: Promise<number>;
	private _pid: number | null = null;
	private tail = "";

	/** What takes it back after a server restart. */
	get handle(): ProcessHandle {
		return { worker: this.worker, channel: this.channel.id };
	}

	constructor(
		private readonly channel: WorkerChannel,
		session: WorkerSession,
		private readonly worker: string,
		{
			resumed = false,
			answerWithin = ANSWER_WITHIN,
		}: {
			resumed?: boolean;
			/** How long a worker has to answer for a process taken back, once it rejoins. */
			answerWithin?: Duration;
		} = {},
	) {
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
		// Whether the worker has said anything on it since this end began.
		let heard = false;
		channel.events.on("data", (frame) => {
			heard = true;
			stdout?.enqueue(frame);
		});
		channel.events.on("message", ({ body }) => {
			heard = true;
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
				if (channel.closed) {
					return;
				}
				channel.send({ type: "describe" });
				// A worker holding the process answers at once. One silent past
				// `answerWithin` lost it in the restart, and would leave the
				// conversation on a turn that never ends: this ends it as a
				// lost process ends, which the conversation reconnects from,
				// and closes the channel, which ends it on the worker too.
				const unanswered = session.timer.setTimeout(() => {
					if (heard || channel.closed) {
						return;
					}
					this.tail ||= `the worker did not answer for it within ${answerWithin.secs}s of rejoining`;
					stdout?.close();
					// Whatever the worker says after it, as its close, is too late.
					stdout = undefined;
					exit.resolve(127);
					channel.dispose();
				}, answerWithin);
				void this.exited.finally(() => unanswered.dispose());
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
