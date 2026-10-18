import { availableParallelism } from "node:os";
import { heavyJobsOfMachine } from "@stringsync/splates-server/heavy";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { type HeavyCap, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { ROOT } from "./root";

export interface TestOptions {
	/** Run only the free eval harness tests. */
	evals?: boolean;
	/** Run the package's and the eval harness's tests together. */
	all?: boolean;
	/** Test files run at once; half the cores when left out. */
	workers?: number;
	ps?: Ps;
	log?: Logger;
	/** The machine's heavy-job slots, one of which the run waits for. */
	heavy?: HeavyCap;
}

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
	const workers =
		opts.workers ?? Math.max(1, Math.floor(availableParallelism() / 2));
	// one of the machine's few heavy-job slots, as splates's `preMerge` takes,
	// so agents testing at once queue rather than run out of memory; run from
	// a `preMerge` hook, it runs in the slot the merge already holds
	const heavy = opts.heavy ?? heavyJobsOfMachine({ fs: new NodeFs(), ps, log });
	// `splates merge` names where its gate wants a JUnit report, to make a
	// todo of each slow test; bun keeps printing its own output beside it
	const report = ps.env("SPLATES_TEST_REPORT");
	await using slot = await heavy.take({ what: "splates dev test" });
	const { exitCode } = await ps.spawn(
		[
			"bun",
			"test",
			"--pass-with-no-tests",
			`--parallel=${workers}`,
			"--timeout",
			"30000",
			...filter,
			...(report ? ["--reporter=junit", `--reporter-outfile=${report}`] : []),
		],
		{ cwd: ROOT, env: slot.env },
	);
	if (exitCode !== 0) {
		throw new Error("Tests failed");
	}
}
