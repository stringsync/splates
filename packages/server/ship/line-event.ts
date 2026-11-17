import type { RunEvent } from "./run-events";
import type { RunLine } from "./step-processes";

/**
 * What a line a step's `run` wrote at `at` says happened in it: the event
 * to keep, or the `failure` its error line reports.
 */
export function eventOfLine(
	line: RunLine,
	target: string,
	step: string,
	at: number,
): RunEvent | { failure: string } {
	switch (line.type) {
		case "output":
			return { type: "output", target, step, text: line.text };
		case "update":
			return { type: "update", target, step, line: line.line };
		case "released":
			return { type: "released", target, step, version: line.version };
		case "withdrawn":
			return { type: "withdrawn", target, step, id: line.id };
		case "error":
			return { failure: line.message };
		default: {
			const { type: _, id, ...prompt } = line;
			return { type: "prompt", at, target, step, id, prompt };
		}
	}
}
