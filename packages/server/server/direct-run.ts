import { join } from "node:path";
import { type SecretStore, SystemSecretStore } from "webappwiz/creds";
import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Ps } from "webappwiz/system";
import { type CloudProvider, FlyCloud } from "../cloud";
import { loadConfig } from "../config";
import { Git } from "../git";
import { splatesHome } from "../models";
import { Spend } from "../spend";
import { FsStorage } from "../storage";
import {
	DIRECT_IDLE,
	DIRECT_TAG,
	DirectRunners,
	type DirectSweep,
	JobSnapshot,
	jobSize,
	NoRunner,
	type RemoteJob,
	type RemoteJobResult,
	runnerKey,
	SshShell,
	snapshotRecipe,
	WorkerBudget,
} from "../workers";
import { TerminalStatus } from "./direct-status";
import { RUNNING } from "./release";

/**
 * Runs `job` on a runner `splates run` makes for itself in the project's
 * cloud, with no `splates server`, as `DirectRunners` does. Null where the
 * project names no cloud, for the caller to run it here; throws `NoRunner`
 * where it names one but no runner can be had, as without the cloud's token
 * or past the budget, so a job meant for a runner never runs here unasked.
 */
export async function runOnDirectRunner(
	ctx: { ps: Ps; fs: Fs; log: Logger; store?: SecretStore },
	job: RemoteJob,
): Promise<RemoteJobResult | null> {
	const toplevel = await gitOut(ctx.ps, job.cwd, [
		"rev-parse",
		"--show-toplevel",
	]);
	const project = await gitOut(ctx.ps, job.cwd, [
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	if (toplevel === null || project === null) {
		return null;
	}
	const config = await loadConfig(toplevel, { fs: ctx.fs });
	const { cloud } = config;
	if (cloud instanceof FlyCloud) {
		throw new NoRunner(
			"Fly direct runners need the proxy transport; use the running splates server meanwhile",
		);
	}
	if (cloud === null) {
		return null;
	}
	return await withRunners(ctx, cloud, async (runners) => {
		const commit =
			job.commit ??
			(await new JobSnapshot(new Git("/", { ps: ctx.ps })).take(toplevel));
		const ran = await runners.run({
			project,
			cwd: toplevel,
			commit,
			size: jobSize(config.job, job.size),
			argv: job.argv,
			env: job.env ?? {},
			prepare: config.prepare,
			timeout: job.timeout ?? null,
			files: job.files ?? [],
			task: ctx.ps.env("SPLATES_TASK") ?? null,
			output: job.output,
			...(job.signal === undefined ? {} : { signal: job.signal }),
		});
		await reapLater(ctx.ps, ctx.fs, toplevel);
		return ran;
	});
}

/**
 * Opens the runners `splates run` makes in `cloud` for `use`, with the
 * machine's budget and ledger and the runner key, made on first use.
 * Throws `NoRunner` without the cloud's token.
 */
export async function withRunners<T>(
	ctx: { ps: Ps; fs: Fs; log: Logger; store?: SecretStore },
	cloud: CloudProvider | FlyCloud,
	use: (runners: DirectRunners) => Promise<T>,
): Promise<T> {
	if (cloud instanceof FlyCloud) {
		throw new NoRunner(
			"Fly direct runners need the proxy transport; use the running splates server meanwhile",
		);
	}
	const store = ctx.store ?? SystemSecretStore.device();
	if ((await store.get(cloud.token.cred)) === undefined) {
		throw new NoRunner(
			`no runner: the project's runners are made in ${cloud.name}, and this machine keeps no ${cloud.token.cred}. Set it up with \`splates setup cloud-token\``,
		);
	}
	const home = splatesHome(ctx.ps);
	const machine = FsStorage.ofMachine(ctx);
	const key = await runnerKey(store, ctx.ps);
	await using shell = await SshShell.open(ctx.ps, key, home);
	await using status = await TerminalStatus.open(ctx);
	const runners = new DirectRunners({
		cloud,
		budget: () => WorkerBudget.open(machine.document("worker-budget.json")),
		ledger: new Spend(machine),
		shell,
		publicKey: key.publicKey,
		recipe: snapshotRecipe("linux", RUNNING)?.script ?? null,
		lock: new FileLock(join(home, "direct-runners", "place.lock"), {
			fs: ctx.fs,
			ps: ctx.ps,
			log: ctx.log,
		}),
		claims: join(home, "direct-runners", "claims.json"),
		ps: ctx.ps,
		log: ctx.log,
		status,
	});
	return await use(runners);
}

/**
 * The runners `splates run` made in `cloud`, as the server's sweep reaps
 * them while it runs, so none is left billing on a laptop that slept; a
 * machine without the cloud's token reaps none.
 */
export function directSweep(
	ctx: { ps: Ps; fs: Fs; log: Logger; store?: SecretStore },
	cloud: CloudProvider | FlyCloud,
): DirectSweep {
	if (cloud instanceof FlyCloud) {
		return { reap: async () => [], names: async () => [] };
	}
	return {
		reap: () =>
			withRunners(ctx, cloud, (runners) => runners.reap()).catch((error) => {
				if (error instanceof NoRunner) {
					return [];
				}
				throw error;
			}),
		names: async () =>
			(await cloud.machines(DIRECT_TAG)).map(
				(machine) => machine.tags[DIRECT_TAG] ?? machine.name,
			),
	};
}

/** Where the pid of the reaper `splates run` leaves behind is kept, under the splates home. */
export const REAPER_FILE = join("direct-runners", "reaper.pid");

/**
 * Leaves a process behind, apart from this one, that reaps the runners once
 * they have stood idle `DIRECT_IDLE`, and again for as long as any is up, so
 * none is left running, and billed, with no `splates run` to come; none when
 * one already watches.
 */
async function reapLater(ps: Ps, fs: Fs, cwd: string): Promise<void> {
	const [bun, script] = process.argv;
	if (bun === undefined || script === undefined) {
		return;
	}
	const held = Number(
		(await fs.read(join(splatesHome(ps), REAPER_FILE)).catch(() => "")).trim(),
	);
	if (Number.isInteger(held) && held > 0 && ps.alive(held)) {
		return;
	}
	void ps
		.spawn(
			[
				"sh",
				"-c",
				'nohup "$@" >/dev/null 2>&1 &',
				"sh",
				bun,
				script,
				"runners",
				"reap",
				"--watch",
				`${DIRECT_IDLE.mins + 1}m`,
			],
			{ cwd },
		)
		.catch(() => {});
}

async function gitOut(
	ps: Ps,
	cwd: string,
	args: string[],
): Promise<string | null> {
	const { exitCode, stdout } = await ps
		.spawnCapture(["git", "-C", cwd, ...args])
		.catch(() => ({ exitCode: 1, stdout: "" }));
	return exitCode === 0 ? stdout.trim() : null;
}
