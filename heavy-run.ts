import type { Logger } from "webappwiz/log";
import type { Fs, HeavyCap, Ps } from "webappwiz/system";
import { fail } from "./exit";
import { heavyJobsOfMachine } from "./heavy";

/**
 * Runs `argv` in one of the machine's heavy-job slots, waiting for one to
 * come free first, and says how it exited. What an agent runs itself (a full
 * test run, an install) passes through arbor no other way.
 */
export async function runHeavy(
	ctx: { fs: Fs; ps: Ps; log: Logger },
	argv: string[],
	heavy: HeavyCap = heavyJobsOfMachine(ctx),
): Promise<number> {
	if (argv.length === 0) {
		fail("usage", "name the command to run: `arbor heavy -- <command>`", {});
	}
	await using slot = await heavy.take({
		what: argv.join(" "),
		task: await taskOf(ctx.ps),
	});
	const { exitCode } = await ctx.ps.spawn(argv, {
		cwd: ctx.ps.cwd(),
		env: slot.env,
	});
	return exitCode;
}

/** The task whose tree this runs in, for the page to name it by. */
async function taskOf(ps: Ps): Promise<string | null> {
	const named = ps.env("ARBOR_TASK");
	if (named !== undefined) {
		return named;
	}
	const { exitCode, stdout } = await ps.spawnCapture(
		["git", "rev-parse", "--abbrev-ref", "HEAD"],
		{ cwd: ps.cwd() },
	);
	const branch = stdout.trim();
	return exitCode === 0 && branch.startsWith("task/")
		? branch.slice("task/".length)
		: null;
}
