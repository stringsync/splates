import { RunError } from "./run-error";
import type { RunState, StepState, TargetState } from "./run-state";
import type { StepRequest } from "./step-processes";

/** The `done` or `run` request of `step`, with what its upstream released. */
export function requestOf(
	state: RunState,
	target: string,
	step: string,
): StepRequest {
	const found = state.targets.find((each) => each.name === target);
	if (found === undefined) {
		throw new Error(`The run has no target "${target}"`);
	}
	const upstream: Record<string, string> = {};
	for (const name of found.dependencies) {
		const released = state.targets.find((each) => each.name === name)?.released;
		if (released !== undefined) {
			upstream[name] = released;
		}
	}
	return {
		command: found.command,
		target,
		step,
		...(found.bump && { bump: found.bump }),
		upstream,
	};
}

export function stepIn(
	state: RunState,
	target: string,
	step: string,
): StepState {
	const found = state.targets
		.find((each) => each.name === target)
		?.steps.find((each) => each.id === step);
	if (found === undefined) {
		throw new RunError(`The run has no step "${step}" of ${target}`, 404);
	}
	return found;
}

export function* stepsOf(
	state: RunState,
): Iterable<{ target: TargetState; step: StepState }> {
	for (const target of state.targets) {
		for (const step of target.steps) {
			yield { target, step };
		}
	}
}

export function keyOf(target: string, step: string): string {
	return `${target}\n${step}`;
}

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
