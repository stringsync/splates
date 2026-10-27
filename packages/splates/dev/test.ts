import { mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fail } from "@stringsync/splates-server/exit";
import { Git } from "@stringsync/splates-server/git";
import {
	GATE_PHASES,
	PREMERGE_HELD,
	SuiteGrants,
} from "@stringsync/splates-server/server";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { PeakMemory, runSummary } from "./peak-memory";
import type { PhaseTimer } from "./phases";
import { AgentPriority } from "./priority";
import { ROOT } from "./root";
import { type ScopeCount, TestScope } from "./test-scope";
import { TestTimings } from "./timings";

/**
 * The longest a test run may take before it is stopped. Tests should not
 * hang this long, even under load.
 */
// At its fewest workers, a quarter of 16 cores, with load near 40, the suite
// took 111s, its time spread over hundreds of files rather than a few slow
// ones, and 140s at 8 workers beside two other runs: 3 minutes left a gate on
// a busier machine too little headroom.
export const TEST_DEADLINE = Duration.mins(6);

export async function test(opts: TestOptions): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	const _log = opts.log ?? new ConsoleLogger();

	if (opts.evals && opts.all) {
		throw new Error("choose either --evals or --all");
	}
	const focused = Boolean(
		opts.changed || opts.since || opts.files?.length || opts.testNamePattern,
	);
	if (!focused && !opts.evals && !opts.allowed) {
		await refuseWholeSuite(
			ps,
			opts.grants ?? new SuiteGrants({ fs: new NodeFs(), ps }),
		);
	}
	if (
		focused &&
		!opts.evals &&
		!opts.allowed &&
		ps.env("SPLATES_CONVERSATION") !== undefined &&
		ps.env(PREMERGE_HELD) === undefined
	) {
		const count = await (
			opts.scope ?? new TestScope(new Git(ROOT, { ps }))
		).count(opts);
		_log.info(
			`Test scope: up to ${count.selected} of ${count.total} test files (before filtering test names).`,
		);
		if (count.total > 0 && count.selected * 2 >= count.total) {
			await refuseWholeSuite(
				ps,
				opts.grants ?? new SuiteGrants({ fs: new NodeFs(), ps }),
				count,
			);
		}
	}
	// An agent's run beside a merge gate makes way for it; its workers inherit the nice.
	(opts.priority ?? new AgentPriority(ps)).lower();
	// The page's tests and the rest run apart, in processes of their own. A DOM test
	// puts happy-dom on `globalThis` for its whole process, `setTimeout`, `URL`
	// and the stream types among it, which the server is tested against. Apart,
	// each run keeps one global and module registry per worker across the files
	// it is handed (`--no-isolate`) instead of a fresh one per file: loading
	// the DOM, React and the page afresh cost each of the page's 200 files a
	// second of CPU, more than its tests took, and the whole suite a quarter
	// of its CPU. The page's run preloads what puts its DOM in place and
	// clears it after each test.
	const evals = opts.all ? [] : ["--path-ignore-patterns=evals/**"];
	const runs: { phase: string; args: string[]; half: "server" | "page" }[] =
		opts.evals
			? [
					{
						phase: "eval tests",
						half: "server",
						args: ["--path-ignore-patterns=packages/**"],
					},
				]
			: [
					{
						phase: "server tests",
						half: "server",
						args: [...evals, "--path-ignore-patterns=packages/web/**"],
					},
					{
						phase: "web tests",
						half: "page",
						args: [
							"--preload=./packages/web/test-preload.ts",
							"--path-ignore-patterns=packages/server/**",
							"--path-ignore-patterns=packages/splates/**",
							"--path-ignore-patterns=evals/**",
						],
					},
				];

	// a worker runs a file at a time; suites opt into within-file concurrency
	// themselves, since most still share a fixture built in beforeEach. Half
	// the cores, not bun's one per core, in a merge's gate too: a worker per
	// core starves the git-spawning suites past the timeout once anything
	// else runs. Three overlapping runs on 16 cores failed 20 to 30 tests
	// each at 16 workers and 0 to 2 at 8, finishing sooner too; one run alone
	// is about 1.5s slower. Gates at 14 workers with the load at 32 took
	// 148 to 170s and timed out; at 8 they took 63 to 78s and none did.
	// Even so, those suites run many times slower under load than alone, so
	// each test gets 30s rather than 5s. A merge's gate names its own share
	// in `SPLATES_CORES`, more on a quiet machine (`gateCores`).
	const gate = Number(ps.env("SPLATES_CORES"));
	const cores =
		opts.workers ??
		(focused
			? 1
			: gate > 0
				? gate
				: Math.max(1, Math.floor(availableParallelism() / 2)));
	// `splates merge` names where its gate wants a JUnit report, to queue a
	// task for each slow test; bun keeps printing its own output beside it.
	const report = ps.env("SPLATES_TEST_REPORT");
	const bunTest = (
		args: string[],
		at: number,
		workers: number,
		timings: string[],
	) => [
		"bun",
		"test",
		"--pass-with-no-tests",
		`--parallel=${workers}`,
		"--no-isolate",
		"--timeout",
		"30000",
		...(opts.ci ? ["--only-failures"] : []),
		...(opts.bail ? ["--bail"] : []),
		...(opts.since
			? [`--changed=${opts.since}`]
			: opts.changed
				? ["--changed"]
				: []),
		...(opts.testNamePattern
			? ["--test-name-pattern", opts.testNamePattern]
			: []),
		...args,
		...(opts.skip ?? []).map((file) => `--path-ignore-patterns=${file}`),
		...timings,
		...(report
			? ["--reporter=junit", `--reporter-outfile=${report}.${at}`]
			: []),
		...(opts.files ?? []),
	];
	// bun's per-test timeout cannot stop a test spinning in a synchronous
	// loop, and such a run once held the machine for ten hours. Ending bun's runner
	// ends its workers too. A run that fails to start ends its sibling.
	const deadline = opts.deadline ?? TEST_DEADLINE;
	const timeout = AbortSignal.timeout(deadline.ms);
	const broke = new AbortController();
	const signal = AbortSignal.any([timeout, broke.signal]);
	const fs = new NodeFs();
	const memory = opts.memory ?? new PeakMemory(ps);
	await using git = await directGit(ps);
	await using scratch = await scratchDir();
	const env = { ...git.env, TMPDIR: scratch.path };
	// A whole run starts each half's slowest files first, by the timings of
	// its last passing gate; a gate's whole run measures them afresh, kept
	// for each half that passed.
	const timings =
		focused || opts.evals
			? null
			: opts.timings !== undefined
				? opts.timings
				: await commonTimings(ps, fs);
	const measures = ps.env(GATE_PHASES) !== undefined;
	// The two halves run side by side, each on its share of the cores,
	// rather than one after the other: each waits on its own slowest
	// file, and the server's last files no longer hold up the page's
	// run. Their workers add up to the cores, never more, as the gate
	// times out under load past them. A run of one worker runs alone, and
	// `--workers <n>` keeps its word, n to each run, one after the other.
	const split =
		opts.workers === undefined
			? sideBySide(
					runs.map(({ half }) => half),
					cores,
				)
			: null;
	let failed = false;
	const reports: (string | null)[] = runs.map(() => null);
	const printed: string[][] = runs.map(() => []);
	const runOne = async (at: number, workers: number) => {
		const run = runs[at];
		if (!run) {
			return;
		}
		const { phase, args, half } = run;
		const ordered = (await timings
			?.forRun(half, measures ? scratch.path : undefined, opts.skip)
			.catch(() => null)) ?? { args: [], kept: async () => {} };
		const command = bunTest(args, at, workers, ordered.args);
		const captured = opts.quiet || split !== null;
		const spawned = async () => {
			if (!captured) {
				return await ps.spawn(command, {
					cwd: ROOT,
					env,
					signal,
				});
			}
			const done = await ps.spawnCapture(command, {
				cwd: ROOT,
				env,
				signal,
			});
			// Side by side, each run's output is printed whole once it
			// ends, so the two never interleave.
			if (opts.quiet) {
				printed[at]?.push(done.stdout, done.stderr);
			} else {
				process.stdout.write(done.stdout);
				process.stderr.write(done.stderr);
			}
			return done;
		};
		// Each run ends on its time, workers and, alone, the peak memory of
		// its process tree, so what a worker costs is seen rather than
		// guessed; side by side, the tree is both runs', measured around them.
		const started = performance.now();
		const timed = <T>(run: () => Promise<T>) =>
			opts.phases
				? opts.phases.time(
						phase,
						run,
						split === null ? {} : { within: TESTS_PHASE },
					)
				: run();
		const measured = async () =>
			split === null
				? await memory.during(spawned)
				: { value: await spawned(), peakMb: null };
		const {
			value: { exitCode },
			peakMb,
		} = await timed(measured).catch((error: unknown) => {
			broke.abort();
			throw error;
		});
		const summary = runSummary({
			phase,
			took: Duration.ms(performance.now() - started),
			workers,
			peakMb,
		});
		if (opts.quiet) {
			printed[at]?.push(`${summary}\n`);
		} else {
			_log.info(summary);
		}
		if (peakMb !== null) {
			await opts.phases?.peak(phase, peakMb);
		}
		failed ||= exitCode !== 0;
		// Timings lost only cost the next run its order.
		await ordered.kept(exitCode === 0).catch(() => {});
		if (report) {
			const xml = await fs.read(`${report}.${at}`).catch(() => null);
			await fs.rm(`${report}.${at}`, { force: true });
			// bun writes none for a run whose files the filters all left out
			if (xml !== null || exitCode !== 0) {
				reports[at] = xml ?? "";
			}
		}
	};
	const ran = async () => {
		if (split === null) {
			for (const at of runs.keys()) {
				await runOne(at, cores);
			}
			return;
		}
		const started = performance.now();
		const { peakMb } = await memory.during(() =>
			Promise.all(split.map((its, at) => runOne(at, its))),
		);
		const summary = runSummary({
			phase: TESTS_PHASE,
			took: Duration.ms(performance.now() - started),
			workers: cores,
			peakMb,
		});
		if (opts.quiet) {
			printed.push([`${summary}\n`]);
		} else {
			_log.info(summary);
		}
		if (peakMb !== null) {
			await opts.phases?.peak(TESTS_PHASE, peakMb);
		}
	};
	await (split !== null && opts.phases
		? opts.phases.time(TESTS_PHASE, ran)
		: ran()
	).catch((error: unknown) => {
		if (timeout.aborted) {
			throw new Error(
				`Tests ran past ${deadline.human()}, so they were stopped: tests should not hang this long, even under load; a test may be stuck in a loop`,
			);
		}
		throw error;
	});
	if (report) {
		await fs.write(
			report,
			joinedReports(reports.filter((xml) => xml !== null)),
		);
	}
	if (failed) {
		for (const text of printed.flat()) {
			process.stderr.write(text);
		}
		throw new Error("Tests failed");
	}
}

/** The phase the two halves run within, side by side. */
const TESTS_PHASE = "tests";

// From the side-by-side gates of 2026-10-26: at three fifths of the cores the
// page's half still ran 1.4 to 1.7 times as long as the server's (62s to 37s
// at 9 workers), about twice the server's worker-seconds, so the page takes
// a little under two thirds.
/** The share of the cores the page's half runs on, side by side with the server's. */
export const PAGE_SHARE = 0.65;

/**
 * The cores each run takes side by side, adding up to `cores`, or null when
 * they run one after the other: a lone run, or too few cores for a worker each.
 */
export function sideBySide(
	halves: ("server" | "page")[],
	cores: number,
): number[] | null {
	if (halves.length !== 2 || cores < 2) {
		return null;
	}
	const page = Math.min(cores - 1, Math.max(1, Math.round(cores * PAGE_SHARE)));
	return halves.map((half) => (half === "page" ? page : cores - page));
}

export interface TestOptions {
	/** Preflight file selection, without executing tests. */
	scope?: Pick<TestScope, "count">;
	/** Run only the free eval harness tests. */
	evals?: boolean;
	/** Run the package's and the eval harness's tests together. */
	all?: boolean;
	/** Run tests affected by uncommitted changes, using Bun's import graph. */
	changed?: boolean;
	/** Compare changes against this git reference instead; implies changed. */
	since?: string;
	/** Run only tests whose name matches this regular expression. */
	testNamePattern?: string;
	/** Print only the failing tests and each run's summary, as bun's `--only-failures`. */
	ci?: boolean;
	/** Run only the test files whose path has one of these, as `bun test` filters. */
	files?: string[];
	/** Test files to leave out, as a gate's whole run does those its recent pass already ran. */
	skip?: string[];
	/**
	 * Test files each run takes at once, the runs one after the other; when
	 * left out, half the cores or the gate's, split between the runs side by
	 * side, and one for a focused run.
	 */
	workers?: number;
	ps?: Ps;
	log?: Logger;
	/** The person's approvals of an agent's whole-suite run; the machine's when left out. */
	grants?: SuiteGrants;
	/** Whether the caller already checked an agent may run the whole suite, as `dev premerge` does. */
	allowed?: boolean;
	/** What puts an agent's run behind a merge gate; this run's own by default. */
	priority?: AgentPriority;
	/** How long the run may take before it is stopped. */
	deadline?: Duration;
	/** Stop each run at its first failing test, as `bun test --bail`. */
	bail?: boolean;
	/** Print nothing unless the tests fail, then all they printed. */
	quiet?: boolean;
	/** What times each bun run for a merge's gate; untimed when left out. */
	phases?: PhaseTimer;
	/** What measures each bun run's peak memory; sampled through `ps` when left out. */
	memory?: PeakMemory;
	/** Where a whole run's per-file timings are kept; the repository's common git dir when left out, none when null. */
	timings?: TestTimings | null;
}

/** The timings kept in the repository's common git dir, or none outside a repository. */
async function commonTimings(ps: Ps, fs: NodeFs): Promise<TestTimings | null> {
	const dir = await new Git(ROOT, { ps }).commonDir().catch(() => null);
	return dir === null ? null : new TestTimings(fs, dir);
}

/**
 * Refuses an agent the whole suite, which is the merge gate's to run, unless
 * the person allowed this conversation's run from its run-command card. A gate's run,
 * and the person's own from a terminal, go ahead.
 */
export async function refuseWholeSuite(
	ps: Ps,
	grants: SuiteGrants,
	count?: ScopeCount,
): Promise<void> {
	const conversation = ps.env("SPLATES_CONVERSATION");
	if (
		conversation === undefined ||
		ps.env(PREMERGE_HELD) !== undefined ||
		(await grants.take(conversation))
	) {
		return;
	}
	fail(
		"not_granted",
		`${count ? `This scope may reach ${count.selected} of ${count.total} test files, at least half the suite. ` : ""}the whole suite is the merge gate's to run, so an agent runs it only once the person approves. Scope it below half the test files: \`--changed\` (tests your uncommitted changes reach), \`--since main\` (once committed), test file paths, or \`--test-name-pattern <regex>\`; \`--evals\` runs the eval harness's tests alone. For a run reaching at least half the files, end your reply with a \`## 🔐 Permission: run command: <why>\` card, the exact refused command alone on a line in backticks (for example, \`\` \`bin/splates dev test --since main\` \`\`) and the why under it, and wait: its Allow lets this conversation run the approved \`splates dev test\` or \`splates dev premerge\` once`,
		{ conversation, ...count },
	);
}

/**
 * Lets `conversation` run the whole suite once, as Allow on its run-command
 * card does from the page. The person's to give: refused from an agent.
 */
export async function approveSuite({
	conversation,
	log,
	ps,
	grants = new SuiteGrants({ fs: new NodeFs(), ps }),
}: {
	conversation: string;
	log: Logger;
	ps: Ps;
	grants?: SuiteGrants;
}): Promise<void> {
	const asking = ps.env("SPLATES_CONVERSATION");
	if (asking !== undefined) {
		fail(
			"not_granted",
			"only the person approves a whole-suite run: end your reply with a `## 🔐 Permission: run command: <why>` card for `bin/splates dev test`",
			{ conversation: asking },
		);
	}
	await grants.grant(conversation);
	log.info(
		`${conversation} may run the whole suite once: tell its agent to run \`splates dev test\``,
	);
}

/**
 * On macOS, an environment whose `git` is the one `/usr/bin/git` hands each
 * call to through `xcrun`, which costs some 10ms of CPU a call. The server's
 * tests spawn git tens of thousands of times: going around `xcrun` cut their
 * CPU by a third. Elsewhere, or with another git first on the PATH, none.
 */
async function directGit(
	ps: Ps,
): Promise<{ env: Record<string, string> } & AsyncDisposable> {
	const none = { env: {}, [Symbol.asyncDispose]: async () => {} };
	const path = ps.env("PATH") ?? "";
	if (
		ps.platform !== "darwin" ||
		Bun.which("git", { PATH: path }) !== "/usr/bin/git"
	) {
		return none;
	}
	const found = await ps
		.spawnCapture(["xcrun", "--find", "git"])
		.catch(() => null);
	if (found?.exitCode !== 0) {
		return none;
	}
	const dir = await mkdtemp(join(tmpdir(), "splates-git-"));
	await symlink(found.stdout.trim(), join(dir, "git"));
	return {
		env: { PATH: `${dir}:${path}` },
		[Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
	};
}

/** What a run's scratch directory, the `TMPDIR` of its tests, is named from. */
const SCRATCH_PREFIX = "splates-test-run-";

/** How old a scratch directory must be for a later run to take it for a killed run's. */
const STALE_SCRATCH = Duration.hrs(1);

/**
 * A directory of the run's own for its tests' `mkdtemp`s, removed with it: a
 * test that never cleaned up, or a run killed at its deadline, left them in
 * the machine's `TMPDIR` by the thousand. Starting one also removes the
 * scratch directories older than an hour, which are a killed run's.
 */
async function scratchDir(): Promise<{ path: string } & AsyncDisposable> {
	const root = tmpdir();
	const names = await readdir(root).catch(() => []);
	await Promise.all(
		names
			.filter((name) => name.startsWith(SCRATCH_PREFIX))
			.map(async (name) => {
				const age = await stat(join(root, name)).then(
					(info) => Date.now() - info.mtimeMs,
					() => 0,
				);
				if (age > STALE_SCRATCH.ms) {
					await rm(join(root, name), { recursive: true, force: true });
				}
			}),
	);
	const path = await mkdtemp(join(root, SCRATCH_PREFIX));
	return {
		path,
		[Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }),
	};
}

const CLOSING = "</testsuites>";

/**
 * Joins the runs' JUnit reports into one report, for the merge gate's
 * attribution. Returns an empty string when a run left none or one cut short,
 * which the gate takes as no report rather than as all tests passed.
 */
export function joinedReports(reports: string[]): string {
	const xmls = reports.map((xml) => xml.trim());
	if (xmls.length === 0 || xmls.some((xml) => !xml.endsWith(CLOSING))) {
		return "";
	}
	/** Where the root's opening tag ends, and its suites start. */
	const inside = (xml: string) =>
		xml.indexOf(">", xml.indexOf("<testsuites")) + 1;
	const head = xmls[0]?.slice(0, inside(xmls[0])) ?? "";
	const suites = xmls.map((xml) => xml.slice(inside(xml), -CLOSING.length));
	return `${head}${suites.join("")}${CLOSING}\n`;
}
