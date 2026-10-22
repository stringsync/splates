import { availableParallelism } from "node:os";
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
	const filter = opts.all
		? []
		: opts.evals
			? ["evals/"]
			: ["--path-ignore-patterns=evals/**"];

	// a worker per file; suites opt into within-file concurrency themselves,
	// since most still share a fixture built in beforeEach. Half the cores, not
	// bun's one per core: several agents test at once, and a worker per core
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
	const bunTest = [
		"bun",
		"test",
		"--pass-with-no-tests",
		`--parallel=${workers}`,
		"--timeout",
		"30000",
		...filter,
		...(report ? ["--reporter=junit", `--reporter-outfile=${report}`] : []),
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
	const argv = opts.linux
		? ["docker", "run", "--rm", "--init", LINUX_IMAGE, ...bunTest]
		: bunTest;
	const { exitCode } = await ps
		.spawn(argv, { cwd: ROOT, env: slot.env, signal })
		.catch((error: unknown) => {
			if (signal.aborted) {
				throw new Error(
					`Tests ran past ${deadline.mins} minutes, so they were stopped: tests should not hang this long, even under load; a test may be stuck in a loop`,
				);
			}
			throw error;
		});
	if (exitCode !== 0) {
		throw new Error("Tests failed");
	}
}
