import { dirname } from "node:path";
import { SYSTEM_STORES } from "@stringsync/splates-server/creds";
import { fail } from "@stringsync/splates-server/exit";
import { splatesHome } from "@stringsync/splates-server/models";
import { Projects } from "@stringsync/splates-server/projects";
import {
	openRepository,
	type Repository,
} from "@stringsync/splates-server/records";
import { Replicator } from "@stringsync/splates-server/replica";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	SETUP_AREAS,
	Setup,
	type SetupProgress,
	type StepProgress,
	type StepStatus,
	setupProjectAt,
	type UndoPlan,
} from "@stringsync/splates-server/setup";
import { fetchWorkers } from "@stringsync/splates-server/workers";
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
	/** Print what undoing the area `step` names would do. */
	undo: boolean;
}

/**
 * `splates setup [step]`: progress by area and the one next step, or one step's
 * why and instructions, after skipping or unskipping it when asked.
 */
export async function setup(
	deps: SplatesDeps,
	opts: SetupOptions,
): Promise<void> {
	if (opts.step === "" && (opts.skip || opts.unskip || opts.undo)) {
		fail("usage", "--skip and --unskip name a step, --undo an area", {});
	}
	if (opts.undo && (opts.skip || opts.unskip)) {
		fail("usage", "--undo names an area, not a step to skip", {
			area: opts.step,
		});
	}
	if (opts.skip && opts.unskip) {
		fail("usage", "--skip or --unskip, not both", { step: opts.step });
	}
	const machine = await setupOf(deps);
	const { log } = deps;
	if (opts.undo) {
		const plan = await machine.undoPlan(opts.step);
		if (opts.json) {
			log.info(JSON.stringify(plan, null, 2));
			return;
		}
		printUndo(log, plan);
		return;
	}
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
			// Only a server this agent runs under, or is pointed at, can be asked.
			workers: deps.ps.env("SPLATES_DEV")
				? () => fetchWorkers({ dev: "", log: deps.log, ps: deps.ps })
				: undefined,
			project:
				root === null
					? undefined
					: setupProjectAt(
							root,
							{ fs, ps },
							{
								// As of the server's last batch, so it reads the same with it stopped.
								replica: () =>
									withRecords(deps, root, ({ storage }) =>
										Replicator.recorded(storage),
									),
								kept: (name) =>
									withRecords(
										deps,
										root,
										async ({ creds }) =>
											(await creds.credentials.get(name)) !== undefined,
									),
							},
						),
		},
		SETUP_AREAS,
	);
}

/** What `read` makes of the records of the project at `root`, closed after. */
async function withRecords<T>(
	deps: SplatesDeps,
	root: string,
	read: (records: Repository) => Promise<T>,
): Promise<T> {
	const records = await openRepository(deps, { at: root });
	try {
		return await read(records);
	} finally {
		records.dispose();
	}
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
				step.warning === null ? "" : "to put right",
			].filter(Boolean);
			log.info(
				`  ${MARKS[step.status]} ${step.id}  ${step.title}${notes.length > 0 ? color.dim(`  ${notes.join("; ")}`) : ""}`,
			);
		}
	}
	const steps = progress.areas.flatMap((area) => area.steps);
	const next = steps.find((step) => step.id === progress.next);
	for (const step of steps.filter((each) => each.warning !== null)) {
		log.info(
			`${color.yellow("put right:")} ${step.title}  ${color.dim(`splates setup ${step.id}`)}`,
		);
	}
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
	if (step.detail !== null) {
		log.info(step.detail);
	}
	if (step.warning !== null) {
		log.info(`${color.yellow("put right:")} ${step.warning}`);
	}
	log.info(`you:    ${step.user}`);
	log.info(`agent:  ${step.agent}`);
	if (step.after.length > 0) {
		log.info(`after:  ${step.after.join(", ")}`);
	}
	if (step.problem !== null) {
		log.info(`${color.red("problem:")} ${step.problem}`);
	}
}

function printUndo(log: Logger, plan: UndoPlan): void {
	log.info(`${color.bold(`Undo ${plan.title}`)}  ${color.dim(plan.area)}`);
	if (plan.refused !== null) {
		log.info(`${color.red("refused:")} ${plan.refused}`);
		return;
	}
	for (const step of plan.steps) {
		const started = step.done ? "" : `  ${color.yellow("started")}`;
		log.info(`  ${step.title}  ${color.dim(step.id)}${started}`);
		for (const line of step.removes) {
			log.info(`    removes  ${line}`);
		}
		for (const line of step.leaves) {
			log.info(`    leaves   ${line}`);
		}
	}
	for (const cred of plan.creds) {
		log.info(
			cred.keptFor === null
				? `  forgets ${cred.name}`
				: `  keeps   ${cred.name}  ${color.dim(`${cred.keptFor} still uses it`)}`,
		);
	}
	if (plan.confirm !== null) {
		log.info(`  the page asks for ${plan.confirm} to be typed`);
	}
	log.info(color.dim("the Setup page's Undo does it, after the user confirms"));
}
