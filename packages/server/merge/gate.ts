import type { Logger } from "webappwiz/log";
import type { Fs, HeavyCap, HeavySlot } from "webappwiz/system";
import type { Config } from "../config";
import type { Git } from "../git";
import type { CoreClaim, CoreClaims } from "../server/shared";
import type { Shell } from "../terminal";
import type { MergeTiming } from "./timing";

/** A hook's output and its fresh JUnit report, kept together for attribution. */
export interface GateRun {
	exitCode: number;
	stdout: string;
	stderr: string;
	xml: string;
}

/** Runs merge checks in the machine's heavy-job slots, including isolated retests. */
export class MergeGate {
	private reserved: HeavySlot | null = null;
	constructor(
		private readonly git: Git,
		private readonly shell: Shell,
		private readonly fs: Fs,
		private readonly heavy: HeavyCap,
		private readonly cores: CoreClaims,
		private readonly config: Config,
		private readonly log: Logger,
		private readonly timing: MergeTiming,
	) {}

	/**
	 * Reserves a heavy slot and cores before a merge takes a tree lock, ahead
	 * of ordinary claims, since others wait on a merge; the gate and its
	 * retests run in them, and a `splates dev test` they run claims no more.
	 */
	async reserve(task: string): Promise<AsyncDisposable> {
		if (!this.command) {
			return { [Symbol.asyncDispose]: async () => {} };
		}
		using _wait = this.timing.track("capacityWaitMs");
		const slot = await this.heavy.take({ what: "preMerge", task });
		// Half the cores heavy jobs share, so the two gates the default slots
		// let run at once both fit.
		const want = Math.max(1, Math.floor(this.cores.budget / 2));
		// Waiting out the claim's timeout only leaves the gate's own test run
		// to claim its cores, as it did before merges claimed any.
		const claim = await this.cores
			.claim({
				what: `preMerge in ${task}`,
				want,
				min: 1,
				first: true,
			})
			.catch((error: unknown): CoreClaim | null => {
				this.log.info(`${String(error)}; the gate runs without them`);
				return null;
			});
		this.reserved = {
			env: { ...slot.env, ...claim?.env },
			[Symbol.asyncDispose]: async () => {},
		};
		return {
			[Symbol.asyncDispose]: async () => {
				this.reserved = null;
				await claim?.[Symbol.asyncDispose]();
				await slot[Symbol.asyncDispose]();
			},
		};
	}

	private async slot(what: string, task: string): Promise<HeavySlot> {
		return this.reserved === null
			? this.heavy.take({ what, task })
			: { env: this.reserved.env, [Symbol.asyncDispose]: async () => {} };
	}

	get command(): string {
		return [this.config.postRewrite, this.config.preMerge]
			.filter(Boolean)
			.join(" && ");
	}

	async run(
		cwd: string,
		task: string,
		{ files }: { files?: string[] } = {},
	): Promise<GateRun> {
		using _time = this.timing.track("gateMs");
		try {
			const report = `${(await this.git.out(cwd, "rev-parse", "--absolute-git-dir")).trim()}/splates-test-report.xml`;
			await this.fs.rm(report, { force: true });
			const command =
				files === undefined
					? this.command
					: [
							"bun test --timeout 30000 --reporter=junit",
							`--reporter-outfile=${quoted(report)}`,
							...files.map((file) => quoted(`./${file}`)),
						].join(" ");
			if (!command) {
				return { exitCode: 0, stdout: "", stderr: "", xml: "" };
			}
			await using slot = await this.slot("preMerge", task);
			const run = await this.shell.run(command, cwd, {
				env: {
					SPLATES_TASK: task,
					SPLATES_WORKTREE: cwd,
					SPLATES_TEST_REPORT: report,
					...slot.env,
				},
				...(files === undefined ? {} : { timeoutMs: 180_000 }),
			});
			return { ...run, xml: await this.fs.read(report).catch(() => "") };
		} catch (error) {
			return { exitCode: 1, stdout: "", stderr: String(error), xml: "" };
		}
	}

	/** The baseline needs its own dependencies, never the task's node_modules. */
	async prepare(cwd: string, task: string): Promise<GateRun> {
		using _time = this.timing.track("gateMs");
		if (!this.config.postRewrite) {
			return { exitCode: 0, stdout: "", stderr: "", xml: "" };
		}
		await using slot = await this.slot("preMerge attribution setup", task);
		const run = await this.shell.run(this.config.postRewrite, cwd, {
			env: { SPLATES_TASK: task, SPLATES_WORKTREE: cwd, ...slot.env },
			timeoutMs: 180_000,
		});
		return { ...run, xml: "" };
	}
}

function quoted(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}
