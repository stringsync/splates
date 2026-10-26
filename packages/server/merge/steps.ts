import { type Clock, SystemClock } from "webappwiz/time";
import type { LivePhase, MergeProgress, MergeStep } from "../tasks";

/**
 * The steps a merge under way has taken, as its task's record keeps them for
 * the page to show it moving: each step from when it began, and the
 * premerge's phases while it tests.
 */
export class MergeSteps {
	private steps: MergeProgress["steps"] = [];
	private phases: LivePhase[] | undefined;

	constructor(private readonly clock: Clock = new SystemClock()) {}

	/** Begins `step`, unless it is the one under way, and gives the record to save. */
	enter(step: MergeStep): MergeProgress {
		if (this.steps.at(-1)?.step !== step) {
			this.steps = [
				...this.steps,
				{ step, at: new Date(this.clock.now().ms).toISOString() },
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

	get progress(): MergeProgress {
		return {
			steps: this.steps,
			...(this.phases === undefined ? {} : { phases: this.phases }),
		};
	}
}
