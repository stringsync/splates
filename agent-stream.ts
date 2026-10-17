import type * as acp from "@agentclientprotocol/sdk";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { AgentFrame, AgentProcess } from "./agent-process";

/** What an `AgentStream` says beyond the messages it carries. */
export interface AgentStreamEvents extends Record<string, unknown> {
	/** A message of the frame with this seq is being handed over. */
	handling: number;
	/** Every message of the frame with this seq has been dispatched. */
	dispatched: number;
	/** A response to a request sent before this stream, by an id under its base. */
	stale: acp.AnyResponse;
	/** A request this side sent, by the id it went out with. */
	request: { id: number; method: string };
}

export interface AgentStreamOptions {
	/**
	 * Where this side's request ids start: after a restart, give one past the
	 * highest id the log holds, so a late answer to an old request comes
	 * back as `stale` rather than as an answer to a new one.
	 */
	base?: number;
}

/** The lines one frame ended, as messages, dispatched one at a time. */
interface Framed {
	seq: number;
	messages: acp.AnyMessage[];
}

/**
 * ACP over an agent's frames, for the SDK's connection to read and write. It
 * hands over one message at a time and waits for the connection to have
 * handled it before the next, so `seq` names the frame of the message being
 * handled while its handler runs. Lines are held until a frame ends on a
 * newline, so a replay from past `dispatched` starts at a line and repeats
 * none.
 */
export class AgentStream implements acp.Stream, Eventful<AgentStreamEvents> {
	readonly readable: ReadableStream<acp.AnyMessage>;
	readonly writable: WritableStream<acp.AnyMessage>;
	private readonly dispatcher = new Dispatcher<AgentStreamEvents>();
	readonly events = this.dispatcher.events;
	/** Added to every request id sent. */
	readonly base: number;
	private readonly frames: Framed[] = [];
	private more = Promise.withResolvers<void>();
	private ended = false;
	/** Text since the last frame that ended on a newline. */
	private partial = "";
	private _seq = 0;
	private _dispatched = 0;
	private _lastId: number | null = null;
	private _asking: acp.JsonRpcId | null = null;
	/** Whether a frame has been handed over in part, which `detach` lets finish. */
	private midFrame = false;
	private detaching: PromiseWithResolvers<void> | null = null;
	private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
	private writing: Promise<void> = Promise.resolve();

	constructor(
		private readonly process: AgentProcess,
		{ base = 0 }: AgentStreamOptions = {},
	) {
		this.base = base;
		void this.read(process.output);
		this.readable = new ReadableStream<acp.AnyMessage>(
			{
				pull: (controller) => this.pull(controller),
				cancel: () => {
					this.ended = true;
					this.more.resolve();
				},
			},
			{ highWaterMark: 0 },
		);
		this.writable = new WritableStream<acp.AnyMessage>({
			write: (message) => this.send(this.outgoing(message)),
			close: () => this.input().close(),
			abort: (reason) => this.input().abort(reason),
		});
	}

	/** The seq of the frame the message being handled came in, 0 before the first. */
	get seq(): number {
		return this._seq;
	}

	/** The highest seq every message of whose frame has been handled. */
	get dispatched(): number {
		return this._dispatched;
	}

	/** The id the last request this side sent went out with; null before the first. */
	get lastId(): number | null {
		return this._lastId;
	}

	/**
	 * The id of the agent's request being handled, for a handler to log
	 * what it is answering; null while the message being handled is not one.
	 */
	get asking(): acp.JsonRpcId | null {
		return this._asking;
	}

	/**
	 * Stops handing messages over at the end of the frame being handled, so
	 * a log flushed after this holds whole frames only, and settles once it
	 * has: the frames after it stay with the process for the next stream.
	 */
	detach(): Promise<void> {
		this.detaching ??= Promise.withResolvers();
		if (!this.midFrame) {
			this.detaching.resolve();
		}
		return this.detaching.promise;
	}

	/**
	 * Answers request `id` of the agent's as it was on the wire, for one a
	 * log holds from before this stream, which the connection never heard.
	 */
	respond(
		id: acp.JsonRpcId,
		answer: { result: unknown } | { error: acp.ErrorResponse },
	): Promise<void> {
		return this.send({ jsonrpc: "2.0", id, ...answer } as acp.AnyResponse);
	}

	private async read(frames: ReadableStream<AgentFrame>): Promise<void> {
		const decoder = new TextDecoder();
		try {
			for await (const frame of frames) {
				this.partial += decoder.decode(frame.bytes, { stream: true });
				// Held with the frames before it that ended mid-line: all of
				// them count dispatched with this one, never ahead of their lines.
				if (!this.partial.endsWith("\n")) {
					continue;
				}
				const lines = this.partial.split("\n");
				this.partial = "";
				this.frames.push({ seq: frame.seq, messages: lines.flatMap(parse) });
				this.more.resolve();
			}
		} catch {
			// A process that never started has no output; its exit says why.
		} finally {
			this.ended = true;
			this.more.resolve();
		}
	}

	private async pull(
		controller: ReadableStreamDefaultController<acp.AnyMessage>,
	): Promise<void> {
		for (;;) {
			if (this.detaching !== null && !this.midFrame) {
				this.detaching.resolve();
				return new Promise(() => {});
			}
			const frame = this.frames[0];
			if (frame === undefined) {
				if (this.ended) {
					controller.close();
					return;
				}
				await this.more.promise;
				this.more = Promise.withResolvers();
				continue;
			}
			const message = frame.messages.shift();
			if (message === undefined) {
				this.finish(frame);
				continue;
			}
			this._seq = frame.seq;
			this.midFrame = true;
			const kept = this.incoming(message);
			if (kept === null) {
				continue;
			}
			this._asking =
				"method" in kept && "id" in kept && kept.id !== undefined
					? kept.id
					: null;
			this.dispatcher.dispatch("handling", frame.seq);
			controller.enqueue(kept);
			// The connection reads it and runs its handler through a chain of
			// microtasks; a macrotask later, the handler has run as far as its
			// first wait, which is past where it writes the message down.
			await settled();
			if (frame.messages.length === 0) {
				this.finish(frame);
			}
			return;
		}
	}

	private finish(frame: Framed): void {
		this.frames.shift();
		this.midFrame = false;
		this._dispatched = frame.seq;
		this.dispatcher.dispatch("dispatched", frame.seq);
	}

	/** A response to this side's request, with the id it asked by; or null for one handed back as stale. */
	private incoming(message: acp.AnyMessage): acp.AnyMessage | null {
		if ("method" in message || typeof message.id !== "number") {
			return message;
		}
		if (message.id < this.base) {
			this.dispatcher.dispatch("stale", message);
			return null;
		}
		return { ...message, id: message.id - this.base };
	}

	private outgoing(message: acp.AnyMessage): acp.AnyMessage {
		if (!("method" in message) || !("id" in message)) {
			return message;
		}
		if (typeof message.id !== "number") {
			return message;
		}
		const id = message.id + this.base;
		this._lastId = id;
		this.dispatcher.dispatch("request", { id, method: message.method });
		return { ...message, id };
	}

	private send(message: acp.AnyMessage): Promise<void> {
		const line = new TextEncoder().encode(`${JSON.stringify(message)}\n`);
		const written = this.writing.then(() => this.input().write(line));
		this.writing = written.catch(() => {});
		return written;
	}

	private input(): WritableStreamDefaultWriter<Uint8Array> {
		this.writer ??= this.process.input.getWriter();
		return this.writer;
	}
}

/** The message on `line`, or none for a blank or unreadable one. */
function parse(line: string): acp.AnyMessage[] {
	const trimmed = line.trim();
	if (trimmed === "") {
		return [];
	}
	try {
		const message: unknown = JSON.parse(trimmed);
		return typeof message === "object" && message !== null
			? [message as acp.AnyMessage]
			: [];
	} catch {
		return [];
	}
}

/** Settles once every microtask queued so far, and what they queue, has run. */
function settled(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
