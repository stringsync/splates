import type { Prompt } from "./run-events";
import type { RunState } from "./run-state";

/** A prompt a ship's step has open, waiting on the user, and where. */
export type Waiting = {
	run: string;
	target: string;
	step: string;
	/** What the step does, as its plan said. */
	does: string;
	id: string;
	prompt: Prompt;
	at: number;
};

/** Every prompt open in `run`, in the order its targets and steps ship. */
export function waitingIn(run: RunState): Waiting[] {
	return run.targets.flatMap((target) =>
		target.steps.flatMap((step) =>
			step.prompts.map((open) => ({
				run: run.id,
				target: target.name,
				step: step.id,
				does: step.does,
				...open,
			})),
		),
	);
}
