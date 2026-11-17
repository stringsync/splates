import type { ProcessHandle } from "../agents/process";
import type { RunLine, RunningStep, StepRequest } from "./step-processes";

/** A step's `run` a test plays: `say` writes a line, `exit` ends it. */
export class FakeRun implements RunningStep {
	readonly answers: { id: string; value: unknown }[] = [];
	readonly lines: AsyncIterable<RunLine>;
	readonly exited: Promise<number>;
	/** What the worker would take back, when this plays one that holds it. */
	handle: ProcessHandle | null = null;
	/** The frame its last yielded line ends, as `say` was told. */
	held: number | null = null;
	readonly acked: number[] = [];
	private readonly queue: { line: RunLine; held?: number }[] = [];
	private wake: () => void = () => {};
	private code: number | null = null;
	private settle: (code: number) => void = () => {};

	constructor(
		readonly request: StepRequest,
		readonly pid: number,
	) {
		this.exited = new Promise((resolve) => {
			this.settle = resolve;
		});
		const self = this;
		this.lines = {
			async *[Symbol.asyncIterator]() {
				for (;;) {
					const next = self.queue.shift();
					if (next !== undefined) {
						if (next.held !== undefined) {
							self.held = next.held;
						}
						yield next.line;
						continue;
					}
					if (self.code !== null) {
						return;
					}
					await new Promise<void>((resolve) => {
						self.wake = resolve;
					});
				}
			},
		};
	}

	/** Writes `line`, the last of frame `held` when given. */
	say(line: RunLine, held?: number): void {
		this.queue.push({ line, ...(held !== undefined && { held }) });
		this.wake();
	}

	exit(code = 0): void {
		this.code = code;
		this.wake();
		this.settle(code);
	}

	ack(seq: number): void {
		this.acked.push(seq);
	}

	stopped = false;

	dispose(): void {
		this.stopped = true;
		this.exit(143);
	}

	async answer(id: string, value: unknown): Promise<void> {
		this.answers.push({ id, value });
	}
}
