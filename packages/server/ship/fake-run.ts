import type { RunLine, RunningStep, StepRequest } from "./step-processes";

/** A step's `run` a test plays: `say` writes a line, `exit` ends it. */
export class FakeRun implements RunningStep {
	readonly answers: { id: string; value: unknown }[] = [];
	readonly lines: AsyncIterable<RunLine>;
	readonly exited: Promise<number>;
	private readonly queue: RunLine[] = [];
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
						yield next;
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

	say(line: RunLine): void {
		this.queue.push(line);
		this.wake();
	}

	exit(code = 0): void {
		this.code = code;
		this.wake();
		this.settle(code);
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
