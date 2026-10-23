import { mkdtemp, rm, symlink } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fail } from "@stringsync/splates-server/exit";
import { PREMERGE_HELD, SuiteGrants } from "@stringsync/splates-server/server";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { ROOT } from "./root";

export interface TestOptions {
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
	/**
	 * Test files run at once; half the cores when left out, one for a focused run.
	 */
	workers?: number;
	ps?: Ps;
	log?: Logger;
	/** The person's approvals of an agent's whole-suite run; the machine's when left out. */
	grants?: SuiteGrants;
	/** Whether the caller already checked an agent may run the whole suite, as `dev premerge` does. */
	allowed?: boolean;
	/** How long the run may take before it is stopped. */
	deadline?: Duration;
	/** Stop each run at its first failing test, as `bun test --bail`. */
	bail?: boolean;
	/** Print nothing unless the tests fail, then all they printed. */
	quiet?: boolean;
}

/**
 * How long a test run may take. Tests should not hang this long, even under
 * load.
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
	// The page's tests and the rest run apart, one after the other. A DOM test
	// puts happy-dom on `globalThis` for its whole process, `setTimeout`, `URL`
	// and the stream types among it, which the server is tested against. Apart,
	// each run keeps one global and module registry per worker across the files
	// it is handed (`--no-isolate`) instead of a fresh one per file: loading
	// the DOM, React and the page afresh cost each of the page's 200 files a
	// second of CPU, more than its tests took, and the whole suite a quarter
	// of its CPU. The page's run preloads what puts its DOM in place and
	// clears it after each test.
	const evals = opts.all ? [] : ["--path-ignore-patterns=evals/**"];
	const runs = opts.evals
		? [["--path-ignore-patterns=packages/**"]]
		: [
				[...evals, "--path-ignore-patterns=packages/web/**"],
				[
					"--preload=./packages/web/test-preload.ts",
					"--path-ignore-patterns=packages/server/**",
					"--path-ignore-patterns=packages/splates/**",
					"--path-ignore-patterns=evals/**",
				],
			];

	// a worker runs a file at a time; suites opt into within-file concurrency
	// themselves, since most still share a fixture built in beforeEach. Half
	// the cores, not bun's one per core: several agents test at once, and a
	// worker per core
	// each starves their git-spawning suites past the 5s timeout. Three
	// overlapping runs on 16 cores failed 20 to 30 tests each at 16 workers and
	// 0 to 2 at 8, finishing sooner too; one run alone is about 1.5s slower.
	// Even so, those suites run many times slower under load than alone, so
	// each test gets 30s rather than 5s.
	const workers =
		opts.workers ??
		(focused ? 1 : Math.max(1, Math.floor(availableParallelism() / 2)));
	// `splates merge` names where its gate wants a JUnit report, to queue a
	// task for each slow test; bun keeps printing its own output beside it.
	const report = ps.env("SPLATES_TEST_REPORT");
	const bunTest = (args: string[], at: number) => [
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
		...(report
			? ["--reporter=junit", `--reporter-outfile=${report}.${at}`]
			: []),
		...(opts.files ?? []),
	];
	// bun's per-test timeout cannot stop a test spinning in a synchronous
	// loop, and such a run once held the machine for ten hours. Ending bun's runner
	// ends its workers too.
	const deadline = opts.deadline ?? TEST_DEADLINE;
	const signal = AbortSignal.timeout(deadline.ms);
	const fs = new NodeFs();
	await using git = await directGit(ps);
	const env = git.env;
	let failed = false;
	const reports: string[] = [];
	const printed: string[] = [];
	for (const [at, args] of runs.entries()) {
		const { exitCode } = await (async () => {
			if (!opts.quiet) {
				return await ps.spawn(bunTest(args, at), { cwd: ROOT, env, signal });
			}
			const done = await ps.spawnCapture(bunTest(args, at), {
				cwd: ROOT,
				env,
				signal,
			});
			printed.push(done.stdout, done.stderr);
			return done;
		})().catch((error: unknown) => {
			if (signal.aborted) {
				throw new Error(
					`Tests ran past ${deadline.human()}, so they were stopped: tests should not hang this long, even under load; a test may be stuck in a loop`,
				);
			}
			throw error;
		});
		failed ||= exitCode !== 0;
		if (report) {
			const xml = await fs.read(`${report}.${at}`).catch(() => null);
			await fs.rm(`${report}.${at}`, { force: true });
			// bun writes none for a run whose files the filters all left out
			if (xml !== null || exitCode !== 0) {
				reports.push(xml ?? "");
			}
		}
	}
	if (report) {
		await fs.write(report, joinedReports(reports));
	}
	if (failed) {
		for (const text of printed) {
			process.stderr.write(text);
		}
		throw new Error("Tests failed");
	}
}

/**
 * Refuses an agent the whole suite, which is the merge gate's to run, unless
 * the person allowed this conversation's run from its run-command card. A gate's run,
 * and the person's own from a terminal, go ahead.
 */
export async function refuseWholeSuite(
	ps: Ps,
	grants: SuiteGrants,
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
		"the whole suite is the merge gate's to run, so an agent runs it only once the person approves. Scope it instead, which needs no approval: `--changed` (tests your uncommitted changes reach), `--since main` (once committed), test file paths, or `--test-name-pattern <regex>`; `--evals` runs the eval harness's tests alone. If only the whole suite will do, end your reply with a `## 🔐 Permission: run command: <why>` card, the command alone on a line in backticks (`` `bin/splates dev test` ``) and the why under it, and wait: its Allow lets this conversation run `splates dev test` or `splates dev premerge` once",
		{ conversation },
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

const CLOSING = "</testsuites>";

/**
 * The runs' JUnit reports as one: the first one's root around every run's
 * suites. Empty when a run left none or one cut short, which the merge gate
 * takes as no report rather than as a run whose tests all passed.
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
