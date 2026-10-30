import type { Logger } from "webappwiz/log";
import type { Git } from "../git";
import type { Facts } from "../records";
import type { WorktreeService } from "../tasks";
import type { MergeGate } from "./gate";
import type { MergeState } from "./merge-state";
import { refuseTestsFailed } from "./refusal";

/**
 * Refuses a merge whose pre-lock checks fail, before it waits for the lock.
 * The refusal reads as a failed gate, blamed on the environment since no
 * test ran.
 */
export async function refuseFailedChecks(
	{
		git,
		service,
		state,
		log,
		runner,
	}: {
		git: Git;
		service: WorktreeService;
		state: MergeState;
		log: Logger;
		runner: MergeGate;
	},
	{
		task,
		branch,
		base,
		cwd,
		onto,
		testedHead,
		lastBase,
		output,
	}: {
		task: string;
		branch: string;
		base: string;
		cwd: string;
		onto: string;
		testedHead: string;
		lastBase: string | null;
		/** The file the checks print to as they run. */
		output?: string;
	},
	facts: Partial<Facts["merge"]>,
): Promise<void> {
	const checked = await runner.checkBeforeLock(cwd, task, output);
	await state.requireLease();
	if (checked.exitCode === 0) {
		return;
	}
	facts.failureAttribution = "environment";
	facts.failedTests = [];
	log.error("the checks before the premerge lock failed");
	await refuseTestsFailed(
		{ git, service, state },
		{
			task,
			branch,
			base,
			cwd,
			command: runner.preLock,
			output: `${checked.stdout}\n${checked.stderr}`,
			...(output === undefined ? {} : { log: output }),
			exitCode: checked.exitCode,
			failing: [],
			onto,
			rebasedOnto: onto,
			testedHead,
			lastBase,
		},
		facts,
	);
}
