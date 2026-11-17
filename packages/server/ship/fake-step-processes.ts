import type { ProcessHandle } from "../agents/process";
import type { ShipEngine } from "./engine";
import { FakeRun } from "./fake-run";
import type { DoneAnswer, StepProcesses, StepRequest } from "./step-processes";

/**
 * Hand it to a {@link ShipEngine} in a test in place of real processes. Set
 * what a step's `done` answers in `done_`, then take each `run` the engine
 * starts with `started("target/step")` and play it as a {@link FakeRun}.
 */
export class FakeStepProcesses implements StepProcesses {
	readonly runs: FakeRun[] = [];
	readonly asked: StepRequest[] = [];
	/** What `done` of each `target/step` answers: true, or a string to throw; false when unset. */
	readonly done_: Map<string, boolean | string> = new Map();
	/** The version `done` of each `target/step` says it found out. */
	readonly released_: Map<string, string> = new Map();
	readonly living = new Set<number>();
	/** Whether a worker holds each run, so it has a handle and is taken back. */
	worker = false;
	/** Each run taken back, and the frame it was taken back from. */
	readonly taken: { run: FakeRun; held: number }[] = [];
	/** Takes a run back as one the worker lost, ending at once. */
	lost = false;
	private pid = 100;
	private waiters: (() => void)[] = [];

	async done(request: StepRequest): Promise<DoneAnswer> {
		this.asked.push(request);
		const name = `${request.target}/${request.step}`;
		const answer = this.done_.get(name);
		if (typeof answer === "string") {
			throw new Error(answer);
		}
		const released = this.released_.get(name);
		return {
			done: answer ?? false,
			...(released !== undefined && { released }),
		};
	}

	run(request: StepRequest): FakeRun {
		const run = new FakeRun(request, this.pid++);
		if (this.worker) {
			run.handle = { worker: "local", channel: run.pid };
		}
		this.runs.push(run);
		for (const wake of this.waiters.splice(0)) {
			wake();
		}
		return run;
	}

	resume(request: StepRequest, handle: ProcessHandle, held: number): FakeRun {
		if (!this.worker) {
			throw new Error("nothing takes it back");
		}
		const run = new FakeRun(request, handle.channel);
		run.handle = handle;
		this.runs.push(run);
		this.taken.push({ run, held });
		if (this.lost) {
			run.exit(127);
		}
		for (const wake of this.waiters.splice(0)) {
			wake();
		}
		return run;
	}

	alive(pid: number): boolean {
		return this.living.has(pid);
	}

	/** The run of `target/step` started last, waiting for it to start. */
	async started(name: string): Promise<FakeRun> {
		for (;;) {
			const found = this.runs.findLast(
				(each) => `${each.request.target}/${each.request.step}` === name,
			);
			if (found !== undefined) {
				return found;
			}
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		}
	}

	/** Which runs started, as `target/step`, in order. */
	names(): string[] {
		return this.runs.map(
			(each) => `${each.request.target}/${each.request.step}`,
		);
	}
}
