import type { CascadeStep } from "./cascade";

/** How many lines of a step's output its fix task quotes. */
export const OUTPUT_LINES = 40;

/** What an agent that takes a fix task is asked: the step, its command, the end of its output and where the log is. */
export function fixText(opts: {
	from: string;
	step: CascadeStep;
	stage: string | null;
	command: string | null;
	output: string;
	log: string;
}): string {
	const { step } = opts;
	return [
		`The ship of ${opts.from} is ${step.status} at ${step.slug}${opts.stage === null ? "" : `, at its step "${opts.stage}"`}${step.note === null ? "" : `: ${step.note}`}.`,
		"",
		opts.command === null
			? "Its ship command is the `ship` in this project's `splates.config.ts`."
			: `Its ship command: \`${opts.command}\``,
		"",
		"The end of its output:",
		"",
		"```",
		opts.output === "" ? "(it printed nothing)" : opts.output,
		"```",
		"",
		`The whole log is at \`${opts.log}\`.`,
		"",
		"Find why it stopped and fix it in this project, then land it through the merge gate. Publish nothing and run no `splates ship`: the cascade runs the step again by itself once this task merges, and npm still asks the person at each publish. When the cause is outside this project's code, ask the person.",
	].join("\n");
}
