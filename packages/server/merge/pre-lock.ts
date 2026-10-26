import type { Logger } from "webappwiz/log";
import type { Git } from "../git";
import type { Facts } from "../records";
import type { WorktreeService } from "../tasks";
import type { MergeGate } from "./gate";
import type { MergeState } from "./merge-state";
import { refuseTestsFailed } from "./refusal";

/**
 * Runs the checks a merge makes before it waits for the premerge lock, which
 * need neither the lock nor the cores, so a failing one refuses now rather
 * than after the line. Refused as a failed gate, blamed on the environment
 * since no test ran.
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
	}: {
		task: string;
		branch: string;
		base: string;
		cwd: string;
		onto: string;
		testedHead: string;
		lastBase: string | null;
	},
	facts: Partial<Facts["merge"]>,
): Promise<void> {
	const checked = await runner.checkBeforeLock(cwd, task);
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
