import type { Logger } from "webappwiz/log";
import type { Fs, HeavyCap, Ps } from "webappwiz/system";
import { type Duration, SystemTimer, type Timer } from "webappwiz/time";
import { loadConfig } from "../config";
import { fail } from "../exit";
import {
	type JobSetting,
	type JobSize,
	jobTimeout,
	NoRunner,
	parseMemory,
	parseTimeout,
	runOnRunner,
	type ServerSend,
} from "../workers";
import { runOnDirectRunner } from "./direct-run";
import { heavyJobsOfMachine } from "./heavy";

/**
 * Runs `argv` in one of the machine's heavy-job slots, waiting for one to
 * come free first, and says how it exited. What an agent runs itself (a full
 * test run, an install) passes through splates no other way. A command that
 * runs past its timeout, the project's `job.timeout` or 30 minutes, is
 * killed and exits 124, so a hung one cannot hold a runner or a slot.
 */
export async function runHeavy(
	ctx: { fs: Fs; ps: Ps; log: Logger; dev?: string; send?: ServerSend },
	argv: string[],
	heavy: HeavyCap = heavyJobsOfMachine(ctx),
	opts: RunHeavyOptions = {},
): Promise<number> {
	if (argv.length === 0) {
		fail("usage", "name the command to run: `splates run -- <command>`", {});
	}
	const size: Partial<JobSize> = {
		...(opts.cpus === undefined ? {} : { cpus: opts.cpus }),
		...(opts.memory === undefined || opts.memory === ""
			? {}
			: { memory: memoryOf(opts.memory) }),
	};
	const timeout = jobTimeout(
		await settingOf(ctx),
		opts.timeout === undefined || opts.timeout === ""
			? undefined
			: timeoutOf(opts.timeout),
	);
	// On a runner of `splates server`'s when it has one, else on one this
	// makes in the project's cloud, its output streamed back; here, in a slot
	// of this machine's, only when the project names no cloud or `local`
	// says so.
	if (opts.local !== true) {
		const job = {
			cwd: ctx.ps.cwd(),
			argv,
			size,
			timeout,
			output:
				opts.write ?? ((bytes: Uint8Array) => void process.stdout.write(bytes)),
		};
		const ran =
			(await runOnRunner(ctx, job)) ??
			(await (opts.direct ?? runOnDirectRunner)(ctx, job).catch(
				(error: unknown) => {
					if (error instanceof NoRunner) {
						fail("no_runner", error.message, {});
					}
					throw error;
				},
			));
		if (ran !== null) {
			return ran.code;
		}
	}
	await using slot = await heavy.take({
		what: argv.join(" "),
		task: await taskOf(ctx.ps),
	});
	const expired = new AbortController();
	const deadline = (opts.timer ?? new SystemTimer()).setTimeout(
		() => expired.abort(),
		timeout,
	);
	try {
		const { exitCode } = await ctx.ps.spawn(argv, {
			cwd: ctx.ps.cwd(),
			env: slot.env,
			signal: expired.signal,
		});
		return exitCode;
	} catch (error) {
		if (!expired.signal.aborted) {
			throw error;
		}
		ctx.log.error(
			`killed after running past its ${timeout.human()} timeout; set a longer one with \`splates run --timeout\` or the project's job.timeout in splates.config.ts`,
		);
		return 124;
	} finally {
		deadline.dispose();
	}
}

/** The `job` setting of the project this runs in, if it is one. */
async function settingOf(ctx: {
	fs: Fs;
	ps: Ps;
}): Promise<JobSetting | undefined> {
	const { exitCode, stdout } = await ctx.ps.spawnCapture(
		["git", "rev-parse", "--show-toplevel"],
		{ cwd: ctx.ps.cwd() },
	);
	return exitCode === 0
		? (await loadConfig(stdout.trim(), { fs: ctx.fs })).job
		: undefined;
}

function timeoutOf(text: string): Duration {
	return (
		parseTimeout(text) ??
		fail(
			"usage",
			`--timeout ${text} is no length of time: name one as 30m, 90s or 2h`,
			{},
		)
	);
}

function memoryOf(text: string): number {
	return (
		parseMemory(text) ??
		fail("usage", `--memory ${text} is no size: name one as 8GB or 512MB`, {})
	);
}

/** How `runHeavy` runs its command. */
export interface RunHeavyOptions {
	/** Runs it here even when a runner has joined. */
	local?: boolean;
	/** Where its output goes; stdout by default. */
	write?: (bytes: Uint8Array) => void;
	/** CPUs it asks of a runner, over the project's `job` setting. */
	cpus?: number;
	/** Memory it asks of a runner, as `8GB` or `512MB`, over the project's `job` setting. */
	memory?: string;
	/** How long it may run before it is killed, as `30m` or `90s`, over the project's `job` setting. */
	timeout?: string;
	/** What times it; the system's by default. */
	timer?: Timer;
	/** Runs it on a runner made for it with no server; `runOnDirectRunner` by default. */
	direct?: typeof runOnDirectRunner;
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
