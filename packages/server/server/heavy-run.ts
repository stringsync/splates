import type { Logger } from "webappwiz/log";
import type { Fs, HeavyCap, Ps } from "webappwiz/system";
import { fail } from "../exit";
import { runOnRunner, type ServerSend } from "../workers";
import { heavyJobsOfMachine } from "./heavy";

/**
 * Runs `argv` in one of the machine's heavy-job slots, waiting for one to
 * come free first, and says how it exited. What an agent runs itself (a full
 * test run, an install) passes through splates no other way.
 */
export async function runHeavy(
	ctx: { fs: Fs; ps: Ps; log: Logger; dev?: string; send?: ServerSend },
	argv: string[],
	heavy: HeavyCap = heavyJobsOfMachine(ctx),
	opts: { local?: boolean; write?: (bytes: Uint8Array) => void } = {},
): Promise<number> {
	if (argv.length === 0) {
		fail("usage", "name the command to run: `splates heavy -- <command>`", {});
	}
	// On a runner when one has joined, its output streamed back; here, in a
	// slot of this machine's, when none has or `local` says so.
	if (opts.local !== true) {
		const ran = await runOnRunner(ctx, {
			cwd: ctx.ps.cwd(),
			argv,
			output: opts.write ?? ((bytes) => void process.stdout.write(bytes)),
		});
		if (ran !== null) {
			return ran.code;
		}
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
	const named = ps.env("SPLATES_TASK");
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
