import type { Logger } from "webappwiz/log";
import type { Fs, HeavyCap, HeavySlot, Lock } from "webappwiz/system";
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

/**
 * Runs merge checks on this machine, including isolated retests: one merge's
 * gate at a time, holding the machine's premerge lock, with every core.
 */
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
		private readonly premerge: Lock,
	) {}

	/**
	 * Reserves the machine for a gate run: call it before a merge takes a tree
	 * lock, and dispose of the result once the gate and its retests are done.
	 * It waits for any other premerge on the machine, then holds every heavy
	 * core, ahead of ordinary claims, so the suite runs alone.
	 */
	async reserve(task: string): Promise<AsyncDisposable> {
		if (!this.command) {
			return { [Symbol.asyncDispose]: async () => {} };
		}
		using _wait = this.timing.track("capacityWaitMs");
		await this.premerge.acquire();
		const slot = await this.heavy
			.take({ what: "preMerge", task })
			.catch(async (error: unknown) => {
				await this.premerge.release();
				throw error;
			});
		// One gate runs at a time, so it has the cores heavy jobs share.
		const want = Math.max(1, this.cores.budget);
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
				await this.premerge.release();
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

	/**
	 * Runs the gate in `cwd`, or just the test `files` of a retest, which with
	 * `at` run on that commit of the repository instead.
	 */
	async run(
		cwd: string,
		task: string,
		{ files, at }: { files?: string[]; at?: string } = {},
	): Promise<GateRun> {
		using _time = this.timing.track("gateMs");
		try {
			if (files === undefined ? !this.command : false) {
				return { exitCode: 0, stdout: "", stderr: "", xml: "" };
			}
			return await this.runHere(cwd, task, { files, at });
		} catch (error) {
			return { exitCode: 1, stdout: "", stderr: String(error), xml: "" };
		}
	}

	/** In a heavy-job slot of this machine's; a retest `at` a commit in a checkout of it made for the run. */
	private async runHere(
		cwd: string,
		task: string,
		{ files, at }: { files?: string[]; at?: string },
	): Promise<GateRun> {
		if (at !== undefined) {
			const scratch = `${(await this.git.out(cwd, "rev-parse", "--absolute-git-dir")).trim()}/splates-attribution`;
			const added = await this.git.run(
				cwd,
				"worktree",
				"add",
				"--detach",
				scratch,
				at,
			);
			if (added.code !== 0) {
				return {
					exitCode: 1,
					stdout: "",
					stderr: `Could not create the baseline checkout: ${added.stderr || added.stdout}`,
					xml: "",
				};
			}
			let result: GateRun;
			try {
				// The baseline needs its own dependencies, never the task's node_modules.
				const prepared = await this.prepare(scratch, task);
				result =
					prepared.exitCode === 0
						? await this.runIn(scratch, task, files)
						: {
								...prepared,
								stderr: `Baseline setup failed: ${prepared.stdout}\n${prepared.stderr}`,
							};
			} catch (error) {
				result = { exitCode: 1, stdout: "", stderr: String(error), xml: "" };
			}
			const removed = await this.git.removeWorktree(scratch);
			return removed.code === 0
				? result
				: {
						exitCode: 1,
						stdout: "",
						stderr: `Could not remove attribution checkout ${scratch}: ${removed.stderr || removed.stdout}`,
						xml: "",
					};
		}
		return this.runIn(cwd, task, files);
	}

	private async runIn(
		cwd: string,
		task: string,
		files: string[] | undefined,
	): Promise<GateRun> {
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
	}

	/** The baseline needs its own dependencies, never the task's node_modules. */
	private async prepare(cwd: string, task: string): Promise<GateRun> {
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
