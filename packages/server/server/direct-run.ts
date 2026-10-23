import { join } from "node:path";
import { type SecretStore, SystemSecretStore } from "webappwiz/creds";
import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Ps } from "webappwiz/system";
import { type CloudProvider, FlyCloud, FlyRunners } from "../cloud";
import { loadConfig } from "../config";
import { Git } from "../git";
import { splatesHome } from "../models";
import { Spend } from "../spend";
import { FsStorage } from "../storage";
import {
	DIRECT_TAG,
	DirectRunners,
	type DirectSweep,
	JobSnapshot,
	jobSize,
	NoRunner,
	type RemoteJob,
	type RemoteJobResult,
	SplatesRunnerBoot,
	WorkerBudget,
} from "../workers";
import { TerminalStatus } from "./direct-status";

/**
 * Runs `job` on a runner `splates run` makes for itself in the project's
 * Fly app, with no `splates server`, as `DirectRunners` does. Null where the
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
	if (cloud === null) {
		return null;
	}
	const git = new Git("/", { ps: ctx.ps });
	return await withRunners(
		ctx,
		cloud,
		async (runners) => {
			const commit = job.commit ?? (await new JobSnapshot(git).take(toplevel));
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
			return ran;
		},
		config.runner.image ?? null,
	);
}

/**
 * Opens the runners `splates run` makes in `cloud` for `use`, with the
 * machine's budget and ledger. Throws `NoRunner` without the cloud's token,
 * and for a cloud other than Fly.io, whose runners only `splates server`
 * makes.
 */
export async function withRunners<T>(
	ctx: { ps: Ps; fs: Fs; log: Logger; store?: SecretStore },
	cloud: CloudProvider | FlyCloud,
	use: (runners: DirectRunners) => Promise<T>,
	image: string | null = null,
): Promise<T> {
	if (!(cloud instanceof FlyCloud)) {
		throw new NoRunner(
			`no runner: \`splates run\` with no \`splates server\` makes runners only in Fly.io, and the project's are made in ${cloud.name}. Start \`splates server\`, or name \`new FlyCloud()\` as the \`cloud\` in splates.config.ts`,
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
	await using status = await TerminalStatus.open(ctx);
	const runners = new DirectRunners({
		runners: new FlyRunners(cloud, {
			boot: new SplatesRunnerBoot(ctx.ps, { image }),
		}),
		budget: () => WorkerBudget.open(machine.document("worker-budget.json")),
		ledger: new Spend(machine),
		snapshot: new JobSnapshot(new Git("/", { ps: ctx.ps })),
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
 * The runners `splates run` made in `cloud`, as the server's sweep settles
 * them while it runs, so a laptop that slept leaves no spend counted for
 * a machine that stopped; a machine without the cloud's token settles none.
 */
export function directSweep(
	ctx: { ps: Ps; fs: Fs; log: Logger; store?: SecretStore },
	cloud: CloudProvider | FlyCloud,
): DirectSweep {
	if (!(cloud instanceof FlyCloud)) {
		return { settle: async () => [], names: async () => [] };
	}
	return {
		settle: () =>
			withRunners(ctx, cloud, (runners) => runners.settle()).catch((error) => {
				if (error instanceof NoRunner) {
					return [];
				}
				throw error;
			}),
		names: async () =>
			(await cloud.list())
				.map((machine) => machine.config.metadata[DIRECT_TAG])
				.filter((name): name is string => name !== undefined),
	};
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
