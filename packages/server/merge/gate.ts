import { availableParallelism } from "node:os";
import type { Fs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { Config } from "../config";
import type { Git } from "../git";
import {
	type PlacedLock,
	PREMERGE_HELD,
	PREMERGE_TIMEOUT_MS,
	RECENT_FAILED_FILES,
} from "../server/shared";
import type { Shell } from "../terminal";
import type { MergeTiming } from "./timing";

/** How long a merge waits for the premerge lock before its line says it is queued. */
export const QUEUED_AFTER_MS = 1000;
/** A hook's output and its fresh JUnit report, kept together for attribution. */
export interface GateRun {
	exitCode: number;
	stdout: string;
	stderr: string;
	xml: string;
	/** Whether it ran past its timeout and was killed. */
	timedOut?: boolean;
}

/**
 * Runs merge checks on this machine, including isolated retests: one merge's
 * gate at a time, holding the machine's premerge lock, each killed past
 * `timeoutMs`.
 */
export class MergeGate {
	constructor(
		private readonly git: Git,
		private readonly shell: Shell,
		private readonly fs: Fs,
		private readonly config: Config,
		private readonly timing: MergeTiming,
		private readonly premerge: PlacedLock,
		private readonly timeoutMs: number = PREMERGE_TIMEOUT_MS,
	) {}

	/**
	 * Holds the machine's premerge lock for a gate run, waiting for any other
	 * premerge on the machine: call it before a merge takes a tree lock, and
	 * dispose of the result once the gate and its retests are done.
	 */
	async reserve(
		/**
		 * Called when the lock is not had within `QUEUED_AFTER_MS`, with this
		 * merge's place in line (1 is next), and again each time the place
		 * changes, one call at a time.
		 */
		onQueued: (place: number) => Promise<void> = async () => {},
	): Promise<AsyncDisposable> {
		if (!this.command) {
			return { [Symbol.asyncDispose]: async () => {} };
		}
		using _wait = this.timing.track("capacityWaitMs");
		let place = 1;
		let queued = false;
		let telling = Promise.resolve();
		const tell = (at: number): Promise<void> => {
			telling = telling.then(() => onQueued(at));
			return telling;
		};
		const acquired = this.premerge
			.acquire((at) => {
				place = at;
				return queued ? tell(at) : undefined;
			})
			.then(() => true);
		// A `Lock` cannot be tried without waiting, so a lock not had soon is taken as held.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const soon = await Promise.race([
			acquired,
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), QUEUED_AFTER_MS);
			}),
		]);
		clearTimeout(timer);
		if (!soon) {
			queued = true;
			await tell(place);
			await acquired;
			await telling;
		}
		return { [Symbol.asyncDispose]: () => this.premerge.release() };
	}

	/** How long the whole gate may run before it is killed. */
	get timeout(): Duration {
		return Duration.ms(this.timeoutMs);
	}

	get command(): string {
		return [this.config.postRewrite, this.config.preMerge]
			.filter(Boolean)
			.join(" && ");
	}

	/**
	 * Runs the gate in `cwd`, or just the test `files` of a retest, which with
	 * `at` run on that commit of the repository instead. The whole gate runs
	 * the `recent` test files that failed earlier gates before the rest.
	 */
	async run(
		cwd: string,
		task: string,
		{
			files,
			at,
			recent,
		}: { files?: string[]; at?: string; recent?: string[] } = {},
	): Promise<GateRun> {
		using _time = this.timing.track("gateMs");
		try {
			if (files === undefined ? !this.command : false) {
				return { exitCode: 0, stdout: "", stderr: "", xml: "" };
			}
			return await this.runHere(cwd, task, { files, at, recent });
		} catch (error) {
			return { exitCode: 1, stdout: "", stderr: String(error), xml: "" };
		}
	}

	/** Here, under the premerge lock; a retest `at` a commit in a checkout of it made for the run. */
	private async runHere(
		cwd: string,
		task: string,
		{ files, at, recent }: { files?: string[]; at?: string; recent?: string[] },
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
						? await this.runIn(scratch, task, files, recent)
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
		return this.runIn(cwd, task, files, recent);
	}

	private async runIn(
		cwd: string,
		task: string,
		files: string[] | undefined,
		recent: string[] = [],
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
		const timeoutMs = files === undefined ? this.timeoutMs : 180_000;
		const started = performance.now();
		const run = await this.shell.run(command, cwd, {
			env: {
				SPLATES_TASK: task,
				SPLATES_WORKTREE: cwd,
				SPLATES_TEST_REPORT: report,
				[PREMERGE_HELD]: "1",
				...(files === undefined && recent.length
					? { [RECENT_FAILED_FILES]: recent.join("\n") }
					: {}),
				// It runs alone on the machine, so it may use all but two cores.
				SPLATES_CORES: String(Math.max(1, availableParallelism() - 2)),
			},
			timeoutMs,
		});
		return {
			...run,
			xml: await this.fs.read(report).catch(() => ""),
			timedOut: run.exitCode !== 0 && performance.now() - started >= timeoutMs,
		};
	}

	/** The baseline needs its own dependencies, never the task's node_modules. */
	private async prepare(cwd: string, task: string): Promise<GateRun> {
		if (!this.config.postRewrite) {
			return { exitCode: 0, stdout: "", stderr: "", xml: "" };
		}
		const run = await this.shell.run(this.config.postRewrite, cwd, {
			env: { SPLATES_TASK: task, SPLATES_WORKTREE: cwd },
			timeoutMs: 180_000,
		});
		return { ...run, xml: "" };
	}
}

function quoted(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}
