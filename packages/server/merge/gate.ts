import { loadavg } from "node:os";
import type { Fs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { Config } from "../config";
import type { Git } from "../git";
import {
	CHECKED_COMMIT,
	GATE_PHASES,
	type PlacedLock,
	PREMERGE_HELD,
	PREMERGE_TIMEOUT_MS,
	RECENT_FAILED_FILES,
} from "../server/shared";
import type { LivePhase } from "../tasks";
import type { Shell } from "../terminal";
import type { GateTrail } from "./cores";
import { TimedPhases } from "./phases";
import type { MergeTiming } from "./timing";

/** How often a whole gate's phases are read while it runs, to show it moving. */
const PHASES_EVERY_MS = 2000;

/** Told a whole gate's phases so far each time they change while it runs. */
export type OnPhases = (phases: LivePhase[]) => Promise<void>;

/** How long a merge waits for the premerge lock before its line says it is queued. */
export const QUEUED_AFTER_MS = 1000;
/** A scratch checkout of one commit, gone once disposed of. */
export interface Checkout extends AsyncDisposable {
	path: string;
}

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
		/** Sizes each run's workers, by the load less the gate before's share. */
		private readonly trail: GateTrail,
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
		/** Aborted by a merge that stops wanting the lock, as a batch's follower does once it is landed. */
		signal?: AbortSignal,
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
			}, signal)
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

	/** The checks to run before the merge waits for the lock, or "". */
	get preLock(): string {
		return this.config.preLock ?? "";
	}

	/**
	 * Runs the `preLock` checks in `cwd` before the merge joins the line, for
	 * the whole gate to skip once it passed on this commit. Needs neither the
	 * lock nor the cores, so it is not timed as the gate and holds nothing.
	 */
	async checkBeforeLock(cwd: string, task: string): Promise<GateRun> {
		const command = this.config.preLock;
		if (!command) {
			return { exitCode: 0, stdout: "", stderr: "", xml: "" };
		}
		const head = (await this.git.out(cwd, "rev-parse", "HEAD")).trim();
		const run = await this.shell.run(command, cwd, {
			env: { SPLATES_TASK: task, SPLATES_WORKTREE: cwd },
			timeoutMs: 180_000,
		});
		if (run.exitCode === 0) {
			this.checked = head;
		}
		return { ...run, xml: "" };
	}

	/** The commit the `preLock` checks passed on, if they did. */
	private checked: string | undefined;

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
	 * the `recent` test files that failed earlier gates before the rest, and
	 * tells `onPhases` its phases as they start and end.
	 */
	async run(
		cwd: string,
		task: string,
		{
			files,
			at,
			recent,
			onPhases,
		}: {
			files?: string[];
			at?: string;
			recent?: string[];
			onPhases?: OnPhases;
		} = {},
	): Promise<GateRun> {
		using _time = this.timing.track("gateMs");
		// Each run is bounded on its own, so the hold starts over with it: a
		// batch's rounds and retests add up past one hold without any hanging.
		this.premerge.renew?.();
		try {
			if (files === undefined ? !this.command : false) {
				return { exitCode: 0, stdout: "", stderr: "", xml: "" };
			}
			return await this.runHere(cwd, task, { files, at, recent, onPhases });
		} catch (error) {
			return { exitCode: 1, stdout: "", stderr: String(error), xml: "" };
		}
	}

	/** Here, under the premerge lock; a retest `at` a commit in a checkout of it made for the run. */
	private async runHere(
		cwd: string,
		task: string,
		{
			files,
			at,
			recent,
			onPhases,
		}: {
			files?: string[];
			at?: string;
			recent?: string[];
			onPhases?: OnPhases;
		},
	): Promise<GateRun> {
		if (at !== undefined) {
			let scratch: Checkout;
			try {
				scratch = await this.checkout(cwd, at, "splates-attribution");
			} catch (error) {
				return {
					exitCode: 1,
					stdout: "",
					stderr: `Could not create the baseline checkout: ${error instanceof Error ? error.message : String(error)}`,
					xml: "",
				};
			}
			let result: GateRun;
			try {
				// The baseline needs its own dependencies, never the task's node_modules.
				const prepared = await this.prepare(scratch.path, task);
				result =
					prepared.exitCode === 0
						? await this.runIn(scratch.path, task, files, recent)
						: {
								...prepared,
								stderr: `Baseline setup failed: ${prepared.stdout}\n${prepared.stderr}`,
							};
			} catch (error) {
				result = { exitCode: 1, stdout: "", stderr: String(error), xml: "" };
			}
			try {
				await scratch[Symbol.asyncDispose]();
			} catch (error) {
				return {
					exitCode: 1,
					stdout: "",
					stderr: `Could not remove attribution checkout ${scratch.path}: ${error instanceof Error ? error.message : String(error)}`,
					xml: "",
				};
			}
			return result;
		}
		return this.runIn(cwd, task, files, recent, onPhases);
	}

	/**
	 * A detached checkout of `at` named `name` in the repository's git
	 * directory, as a batch gates its stacked tip in, removed when disposed
	 * of; throws when git cannot make or remove it. Run the whole gate there
	 * with `run`, which installs its dependencies as the command's
	 * `postRewrite` does.
	 */
	async checkout(cwd: string, at: string, name: string): Promise<Checkout> {
		const path = `${(await this.git.out(cwd, "rev-parse", "--absolute-git-dir")).trim()}/${name}`;
		const added = await this.git.run(
			cwd,
			"worktree",
			"add",
			"--detach",
			path,
			at,
		);
		if (added.code !== 0) {
			throw new Error(added.stderr || added.stdout);
		}
		return {
			path,
			[Symbol.asyncDispose]: async () => {
				const removed = await this.git.removeWorktree(path);
				if (removed.code !== 0) {
					throw new Error(removed.stderr || removed.stdout);
				}
			},
		};
	}

	private async runIn(
		cwd: string,
		task: string,
		files: string[] | undefined,
		recent: string[] = [],
		onPhases?: OnPhases,
	): Promise<GateRun> {
		const gitDir = (
			await this.git.out(cwd, "rev-parse", "--absolute-git-dir")
		).trim();
		const report = `${gitDir}/splates-test-report.xml`;
		const phases = `${gitDir}/splates-gate-phases.jsonl`;
		await this.fs.rm(report, { force: true });
		await this.fs.rm(phases, { force: true });
		const command =
			files === undefined
				? this.command
				: [
						"bun test --timeout 30000 --reporter=junit",
						`--reporter-outfile=${quoted(report)}`,
						...files.map((file) => quoted(`./${file}`)),
					].join(" ");
		const timeoutMs = files === undefined ? this.timeoutMs : 180_000;
		const load = loadavg()[0] ?? 0;
		const workers = await this.trail.size();
		const started = performance.now();
		await using _watch = this.watchPhases(
			files === undefined ? onPhases : undefined,
			phases,
		);
		const run = await this.shell.run(command, cwd, {
			env: {
				SPLATES_TASK: task,
				SPLATES_WORKTREE: cwd,
				SPLATES_TEST_REPORT: report,
				[PREMERGE_HELD]: "1",
				...(files === undefined && this.checked !== undefined
					? { [CHECKED_COMMIT]: this.checked }
					: {}),
				SPLATES_CORES: String(workers),
				...(files === undefined
					? {
							[GATE_PHASES]: phases,
							...(recent.length
								? { [RECENT_FAILED_FILES]: recent.join("\n") }
								: {}),
						}
					: {}),
			},
			timeoutMs,
		});
		const ranMs = performance.now() - started;
		// A record lost only sizes the next gate by the whole load, as before.
		await this.trail.ran(workers, Duration.ms(ranMs)).catch(() => {});
		if (files === undefined) {
			const timed = new TimedPhases(await this.fs.read(phases).catch(() => ""));
			const peakMb = timed.peaks();
			const within = timed.within();
			this.timing.gated({
				workers,
				load,
				ms: timed.of(ranMs),
				...(Object.keys(peakMb).length ? { peakMb } : {}),
				...(Object.keys(within).length ? { within } : {}),
			});
		}
		return {
			...run,
			xml: await this.fs.read(report).catch(() => ""),
			timedOut: run.exitCode !== 0 && ranMs >= timeoutMs,
		};
	}

	/**
	 * Reads the phases file at `path` every few seconds until disposed of,
	 * telling `onPhases` whenever what it lists changed. A read or a telling
	 * that fails only leaves the page a step behind.
	 */
	private watchPhases(
		onPhases: OnPhases | undefined,
		path: string,
	): AsyncDisposable {
		if (onPhases === undefined) {
			return { [Symbol.asyncDispose]: async () => {} };
		}
		let told = "[]";
		let telling: Promise<void> = Promise.resolve();
		const look = async () => {
			const phases = new TimedPhases(
				await this.fs.read(path).catch(() => ""),
			).live();
			const said = JSON.stringify(phases);
			if (said !== told) {
				told = said;
				await onPhases(phases).catch(() => {});
			}
		};
		const timer = setInterval(() => {
			// One at a time, so an older list never lands after a newer one.
			telling = telling.then(look);
		}, PHASES_EVERY_MS);
		return {
			[Symbol.asyncDispose]: async () => {
				clearInterval(timer);
				await telling;
			},
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
