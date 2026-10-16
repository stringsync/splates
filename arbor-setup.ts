import type { Logger } from "webappwiz/log";
import { color } from "webappwiz/log";
import type { ArborDeps } from "./arbor";
import { SYSTEM_STORES } from "./creds";
import { arborHome } from "./roster";
import {
	Setup,
	type SetupProgress,
	type StepProgress,
	type StepStatus,
} from "./setup";
import { SETUP_AREAS } from "./setup-areas";

/** This machine's setup, read through `deps`. */
export function setupOf({
	fs,
	ps,
	secrets = SYSTEM_STORES,
	fetch,
}: ArborDeps): Setup {
	return new Setup(
		{ fs, home: arborHome(ps), device: secrets.device, fetch },
		SETUP_AREAS,
	);
}

/** What `arbor setup` was asked for. */
export interface SetupOptions {
	/** A step's id, or empty for every area's progress. */
	step: string;
	json: boolean;
	skip: boolean;
	unskip: boolean;
}

/**
 * `arbor setup [step]`: progress by area and the one next step, or one step's
 * why and instructions, after skipping or unskipping it when asked.
 */
export async function setup(
	deps: ArborDeps,
	opts: SetupOptions,
): Promise<void> {
	const machine = setupOf(deps);
	const { log } = deps;
	if (opts.step !== "") {
		machine.step(opts.step);
		if (opts.skip) {
			await machine.skip(opts.step);
		} else if (opts.unskip) {
			await machine.unskip(opts.step);
		}
	}
	const progress = await machine.read();
	if (opts.step === "") {
		if (opts.json) {
			log.info(JSON.stringify(progress, null, 2));
			return;
		}
		printProgress(log, progress);
		return;
	}
	const step = progress.areas
		.flatMap((area) => area.steps)
		.find((each) => each.id === opts.step) as StepProgress;
	if (opts.json) {
		log.info(JSON.stringify(step, null, 2));
		return;
	}
	printStep(log, step);
}

const MARKS: Record<StepStatus, string> = {
	done: color.green("✓"),
	skipped: color.dim("-"),
	ready: color.yellow("○"),
	waiting: color.dim("○"),
};

function printProgress(log: Logger, progress: SetupProgress): void {
	for (const area of progress.areas) {
		const counts = [
			`${area.done}/${area.steps.length} done`,
			area.skipped > 0 ? `${area.skipped} skipped` : "",
		].filter(Boolean);
		log.info(`${color.bold(area.title)}  ${color.dim(counts.join(", "))}`);
		for (const step of area.steps) {
			const notes = [
				step.optional ? "optional" : "",
				step.status === "waiting" ? `after ${step.after.join(", ")}` : "",
				step.problem ?? "",
			].filter(Boolean);
			log.info(
				`  ${MARKS[step.status]} ${step.id}  ${step.title}${notes.length > 0 ? color.dim(`  ${notes.join("; ")}`) : ""}`,
			);
		}
	}
	const next = progress.areas
		.flatMap((area) => area.steps)
		.find((step) => step.id === progress.next);
	log.info(
		next === undefined
			? color.green("nothing left to set up")
			: `next: ${next.title}  ${color.dim(`arbor setup ${next.id}`)}`,
	);
}

function printStep(log: Logger, step: StepProgress): void {
	log.info(
		`${color.bold(step.title)}  ${color.dim(`${step.status}${step.optional ? ", optional" : ""}`)}`,
	);
	log.info(step.why);
	log.info(`you:    ${step.user}`);
	log.info(`agent:  ${step.agent}`);
	if (step.after.length > 0) {
		log.info(`after:  ${step.after.join(", ")}`);
	}
	if (step.problem !== null) {
		log.info(`${color.red("problem:")} ${step.problem}`);
	}
}
