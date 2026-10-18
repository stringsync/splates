import { dirname } from "node:path";
import { SYSTEM_STORES } from "@stringsync/splates-server/creds";
import { splatesHome } from "@stringsync/splates-server/models";
import { Projects } from "@stringsync/splates-server/projects";
import type { SplatesDeps } from "@stringsync/splates-server/runtime-deps";
import {
	SETUP_AREAS,
	Setup,
	type SetupProgress,
	type StepProgress,
	type StepStatus,
	setupProjectAt,
} from "@stringsync/splates-server/setup";
import type { Logger } from "webappwiz/log";
import { color } from "webappwiz/log";
import type { Ps } from "webappwiz/system";

/** What `splates setup` was asked for. */
export interface SetupOptions {
	/** A step's id, or empty for every area's progress. */
	step: string;
	json: boolean;
	skip: boolean;
	unskip: boolean;
}

/**
 * `splates setup [step]`: progress by area and the one next step, or one step's
 * why and instructions, after skipping or unskipping it when asked.
 */
export async function setup(
	deps: SplatesDeps,
	opts: SetupOptions,
): Promise<void> {
	const machine = await setupOf(deps);
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

/**
 * This machine's setup, read through `deps`, for the project `--project`
 * names or the repository the working directory is in, if either.
 */
export async function setupOf(deps: SplatesDeps): Promise<Setup> {
	const { fs, ps, secrets = SYSTEM_STORES, fetch } = deps;
	const root =
		deps.project === undefined
			? await repoRoot(ps)
			: (await Projects.ofMachine(deps).named(deps.project)).root;
	return new Setup(
		{
			fs,
			ps,
			home: splatesHome(ps),
			device: secrets.device,
			fetch,
			project: root === null ? undefined : setupProjectAt(root, { fs, ps }),
		},
		SETUP_AREAS,
	);
}

/** The main tree of the repository the working directory is in, or null. */
async function repoRoot(ps: Ps): Promise<string | null> {
	const { exitCode, stdout } = await ps.spawnCapture([
		"git",
		"-C",
		ps.cwd(),
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	return exitCode === 0 ? dirname(stdout.trim()) : null;
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
			: `next: ${next.title}  ${color.dim(`splates setup ${next.id}`)}`,
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
