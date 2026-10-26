import {
	type Clock,
	SystemClock,
	SystemWallClock,
	type WallClock,
} from "webappwiz/time";
import type { LivePhase, MergeProgress, MergeStep } from "../tasks";
import { outputPath } from "./output";

/**
 * The steps a merge under way has taken, as its task's record keeps them for
 * the page to show it moving: each step from when it began, and the
 * premerge's phases while it tests.
 */
export class MergeSteps {
	private steps: MergeProgress["steps"] = [];
	private phases: LivePhase[] | undefined;
	private readonly starts: number[] = [];

	constructor(
		private readonly clock: Clock = new SystemClock(),
		private readonly wall: WallClock = new SystemWallClock(),
	) {}

	/**
	 * Begins `step`, unless it is the one under way, and gives the record to
	 * save. `output` names the file its command prints to, for the page to
	 * follow; given for the step under way, it takes it too.
	 */
	enter(step: MergeStep, output?: string): MergeProgress {
		const last = this.steps.at(-1);
		if (last?.step === step) {
			if (output !== undefined && last.output === undefined) {
				this.steps = [...this.steps.slice(0, -1), { ...last, output }];
			}
		} else {
			this.starts.push(this.clock.now().ms);
			this.steps = [
				...this.steps,
				{
					step,
					at: new Date(this.wall.now()).toISOString(),
					...(output === undefined ? {} : { output }),
				},
			];
			// The phases stay shown past the premerge, until another starts afresh.
			if (step === "test") {
				this.phases = undefined;
			}
		}
		return this.progress;
	}

	/** Takes the premerge's phases so far, and gives the record to save. */
	phased(phases: LivePhase[]): MergeProgress {
		this.phases = phases;
		return this.progress;
	}

	/**
	 * The milliseconds spent in each step so far, each step's runs summed
	 * across retests, the one under way up to now.
	 */
	get ms(): Partial<Record<MergeStep, number>> {
		const now = this.clock.now().ms;
		const ms: Partial<Record<MergeStep, number>> = {};
		this.steps.forEach(({ step }, index) => {
			// Calendar timestamps go to the page; elapsed times must survive clock adjustments.
			const took =
				(this.starts[index + 1] ?? now) - (this.starts[index] ?? now);
			ms[step] = (ms[step] ?? 0) + Math.max(0, took);
		});
		return ms;
	}

	/** Where the step to come, the merge's next, would keep its output. */
	outputOf(gitDir: string, step: MergeStep): string {
		const last = this.steps.at(-1);
		const index =
			last?.step === step ? this.steps.length - 1 : this.steps.length;
		return outputPath(gitDir, index, step);
	}

	get progress(): MergeProgress {
		return {
			steps: this.steps,
			...(this.phases === undefined ? {} : { phases: this.phases }),
		};
	}
}
