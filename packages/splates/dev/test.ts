import { mkdtemp, rm, symlink } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CoreClaims,
	coreClaimsOfMachine,
	heavyJobsOfMachine,
} from "@stringsync/splates-server/server";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { type HeavyCap, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { ROOT } from "./root";

export interface TestOptions {
	/** Run only the free eval harness tests. */
	evals?: boolean;
	/** Run the package's and the eval harness's tests together. */
	all?: boolean;
	/**
	 * Run the tests on Linux, in a Docker container built from the checkout
	 * (`docker/test.Dockerfile`), as the server's box and the workers
	 * run them.
	 */
	linux?: boolean;
	/** Run only the test files whose path has one of these, as `bun test` filters. */
	files?: string[];
	/**
	 * Test files run at once; half the cores when left out, fewer (down to half
	 * of that) when the machine's other heavy jobs hold some of its cores.
	 */
	workers?: number;
	ps?: Ps;
	log?: Logger;
	/** The machine's heavy-job slots, one of which the run waits for. */
	heavy?: HeavyCap;
	/** The machine's cores, which the run claims its workers from. */
	cores?: CoreClaims;
	/** How long the run may take before it is stopped. */
	deadline?: Duration;
}

/**
 * How long a test run may hold its heavy slot. Tests should not hang this
 * long, even under load.
 */
// At its fewest workers, a quarter of 16 cores, with load near 40, the suite
// took 111s, its time spread over hundreds of files rather than a few slow
// ones, and 140s at 8 workers beside two other runs: 3 minutes left a gate on
// a busier machine too little headroom.
export const TEST_DEADLINE = Duration.mins(6);

/** The image `--linux` builds from the checkout and runs the tests in. */
export const LINUX_IMAGE = "splates-test";

export async function test(opts: TestOptions): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	const log = opts.log ?? new ConsoleLogger();

	if (opts.evals && opts.all) {
		throw new Error("choose either --evals or --all");
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
		? [["evals/"]]
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
	const want =
		opts.workers ?? Math.max(1, Math.floor(availableParallelism() / 2));
	// one of the machine's few heavy-job slots, as splates's `preMerge` takes,
	// so agents testing at once queue rather than run out of memory; run from
	// a `preMerge` hook, it runs in the slot the merge already holds
	const heavy = opts.heavy ?? heavyJobsOfMachine({ fs: new NodeFs(), ps, log });
	// `splates merge` names where its gate wants a JUnit report, to queue a
	// task for each slow test; bun keeps printing its own output beside it.
	// Not on Linux, where the path would be the container's.
	const report = opts.linux ? undefined : ps.env("SPLATES_TEST_REPORT");
	await using slot = await heavy.take({ what: "splates dev test" });
	// a worker is a core claimed: when other heavy jobs hold the machine's
	// cores the run waits (five minutes at most) for half its workers, rather
	// than starve the server and the agents; asked for workers by number, it
	// waits for exactly those. Run in a merge's gate, it takes the cores the
	// merge claimed, first in line, and claims none of its own
	const claims =
		opts.cores ?? coreClaimsOfMachine({ fs: new NodeFs(), ps, log });
	await using claim = await claims.claim({
		what: "splates dev test",
		want,
		min: opts.workers === undefined ? Math.max(1, Math.floor(want / 2)) : want,
	});
	const workers = claim.cores;
	const bunTest = (args: string[], at: number) => [
		"bun",
		"test",
		"--pass-with-no-tests",
		`--parallel=${workers}`,
		"--no-isolate",
		"--timeout",
		"30000",
		...args,
		...(report
			? ["--reporter=junit", `--reporter-outfile=${report}.${at}`]
			: []),
		...(opts.files ?? []),
	];
	// The image is built in the slot, since an install is a heavy job, but
	// ahead of the deadline: the first build pulls the base image and
	// installs every dependency, minutes that are not the tests'.
	if (opts.linux) {
		const build = await ps.spawn(
			[
				"docker",
				"build",
				"-f",
				"docker/test.Dockerfile",
				"-t",
				LINUX_IMAGE,
				".",
			],
			{ cwd: ROOT, env: slot.env },
		);
		if (build.exitCode !== 0) {
			throw new Error(
				"Building the Linux test image failed: is Docker running?",
			);
		}
	}
	// bun's per-test timeout cannot stop a test spinning in a synchronous
	// loop, and such a run held its slot for ten hours while every add, merge
	// and conversation on the machine queued behind it. Ending bun's runner
	// ends its workers too; `docker run` passes the signal on to the
	// container's bun, and `--init` reaps what the tests spawn under it.
	const deadline = opts.deadline ?? TEST_DEADLINE;
	const signal = AbortSignal.timeout(deadline.ms);
	const fs = new NodeFs();
	await using git = await directGit(ps);
	const env = { ...slot.env, ...git.env };
	let failed = false;
	const reports: string[] = [];
	for (const [at, args] of runs.entries()) {
		const argv = opts.linux
			? ["docker", "run", "--rm", "--init", LINUX_IMAGE, ...bunTest(args, at)]
			: bunTest(args, at);
		const { exitCode } = await ps
			.spawn(argv, { cwd: ROOT, env, signal })
			.catch((error: unknown) => {
				if (signal.aborted) {
					throw new Error(
						`Tests ran past ${deadline.mins} minutes, so they were stopped: tests should not hang this long, even under load; a test may be stuck in a loop`,
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
		throw new Error("Tests failed");
	}
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
