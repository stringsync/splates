import type { AgentFrame, AgentProcess } from "./agent-process";

/** Everything `process` prints to stdout, once it closes it, as text. */
export async function printed(
	process: Pick<AgentProcess, "output">,
): Promise<string> {
	const decoder = new TextDecoder();
	let text = "";
	for await (const frame of process.output) {
		text += decoder.decode(frame.bytes, { stream: true });
	}
	return text + decoder.decode();
}

/**
 * An `AgentProcess` a test feeds by hand: each `print` is one frame of its
 * stdout, numbered as it comes, and `typed` is what was written to its stdin,
 * line by line.
 */
export class HandFedProcess implements AgentProcess {
	readonly pid = 1;
	readonly handle = null;
	readonly input: WritableStream<Uint8Array>;
	readonly output: ReadableStream<AgentFrame>;
	readonly exited: Promise<number>;
	/** Each line written to its stdin, as text. */
	readonly typed: string[] = [];
	/** Each seq acked, in order. */
	readonly acked: number[] = [];
	killed = false;
	private stdout: ReadableStreamDefaultController<AgentFrame> | undefined;
	private seq = 0;
	private exit: (code: number) => void = () => {};

	constructor() {
		this.output = new ReadableStream<AgentFrame>({
			start: (controller) => {
				this.stdout = controller;
			},
		});
		this.input = new WritableStream<Uint8Array>({
			write: (bytes) => {
				this.typed.push(new TextDecoder().decode(bytes));
			},
		});
		this.exited = new Promise((resolve) => {
			this.exit = resolve;
		});
	}

	/** Prints `text` as one frame, answering with its seq. */
	print(text: string): number {
		this.stdout?.enqueue({
			bytes: new TextEncoder().encode(text),
			seq: ++this.seq,
		});
		return this.seq;
	}

	/** Closes stdout and exits with `code`. */
	end(code = 0): void {
		this.stdout?.close();
		this.exit(code);
	}

	stderr(): string {
		return "";
	}

	ack(seq: number): void {
		this.acked.push(seq);
	}

	kill(): void {
		this.killed = true;
	}
}
