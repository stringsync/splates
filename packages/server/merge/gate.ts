import type { Logger } from "webappwiz/log";
import type { Fs, HeavyCap, HeavySlot, Ps } from "webappwiz/system";
import type { Config } from "../config";
import type { Git } from "../git";
import type { CoreClaim, CoreClaims } from "../server/shared";
import type { Shell } from "../terminal";
import { runOnRunner, serverOf } from "../workers";
import type { MergeTiming } from "./timing";

/** A hook's output and its fresh JUnit report, kept together for attribution. */
export interface GateRun {
	exitCode: number;
	stdout: string;
	stderr: string;
	xml: string;
}

/** What the gate reaches a runner through: the `splates server` its agent runs under. */
export interface GateRunners {
	ps: Ps;
	dev?: string;
	send?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Where a runner job's JUnit report comes back from, in `SPLATES_JOB_FILES`. */
const REPORT = "report.xml";

/**
 * Runs merge checks on a runner when one is to be had, else in the machine's
 * heavy-job slots, including isolated retests.
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
		private readonly runners: GateRunners | null = null,
	) {}

	/**
	 * Reserves a heavy slot and cores before a merge takes a tree lock, ahead
	 * of ordinary claims, since others wait on a merge; the gate and its
	 * retests run in them, and a `splates dev test` they run claims no more.
	 */
	async reserve(task: string): Promise<AsyncDisposable> {
		// Under a server the gate asks the pool for a runner, ahead of ordinary
		// jobs, and takes a slot here only for a job sent to run here.
		if (!this.command || (await this.reachesServer())) {
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

	private async reachesServer(): Promise<boolean> {
		return (
			this.runners !== null &&
			(await serverOf({ ...this.runners, fs: this.fs, log: this.log })) !== null
		);
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
			const remote =
				(files !== undefined || Boolean(this.config.preMerge)) &&
				(await this.reachesServer());
			const [ran, installed] = remote
				? await Promise.all([
						this.onRunner(cwd, task, { files, at }),
						// The coordinator's worktree needs its own install whatever a runner does.
						files === undefined && this.config.postRewrite
							? this.install(cwd, task)
							: null,
					])
				: [null, null];
			if (ran !== null) {
				return ran.exitCode === 0 && installed !== null ? installed : ran;
			}
			return await this.runHere(cwd, task, { files, at });
		} catch (error) {
			return { exitCode: 1, stdout: "", stderr: String(error), xml: "" };
		}
	}

	/** On a runner; null when none is to be had, for the caller to run it here. */
	private async onRunner(
		cwd: string,
		task: string,
		{ files, at }: { files?: string[]; at?: string },
	): Promise<GateRun | null> {
		if (this.runners === null) {
			return null;
		}
		const out: Uint8Array[] = [];
		const ran = await runOnRunner(
			{ ...this.runners, fs: this.fs, log: this.log },
			{
				cwd,
				// The runner has installed what the job's checkout needs: its
				// `prepare` runs first.
				argv:
					files === undefined
						? [
								"sh",
								"-c",
								`SPLATES_TEST_REPORT="$SPLATES_JOB_FILES/${REPORT}"; export SPLATES_TEST_REPORT; ${this.config.preMerge}`,
							]
						: [
								"sh",
								"-c",
								`exec bun test --timeout 30000 --reporter=junit "--reporter-outfile=$SPLATES_JOB_FILES/${REPORT}" "$@"`,
								"sh",
								...files.map((file) => `./${file}`),
							],
				env: { SPLATES_TASK: task },
				files: [REPORT],
				first: true,
				...(at === undefined ? {} : { commit: at }),
				output: (bytes) => void out.push(bytes),
				...(files === undefined
					? {}
					: { signal: AbortSignal.timeout(600_000) }),
			},
		);
		if (ran === null) {
			return null;
		}
		return {
			exitCode: ran.code,
			stdout: new TextDecoder().decode(Buffer.concat(out)),
			stderr: "",
			xml: new TextDecoder().decode(ran.files.get(REPORT) ?? new Uint8Array()),
		};
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

	/** `postRewrite` in `cwd`, outside a slot: an install, not a test run. */
	private async install(cwd: string, task: string): Promise<GateRun> {
		const run = await this.shell.run(this.config.postRewrite ?? "", cwd, {
			env: { SPLATES_TASK: task, SPLATES_WORKTREE: cwd },
		});
		return { ...run, xml: "" };
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
