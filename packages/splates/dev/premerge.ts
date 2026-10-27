import { access } from "node:fs/promises";
import { join } from "node:path";
import {
	CHECKED_COMMIT,
	PREMERGE_HELD,
	PREMERGE_TIMEOUT_MS,
	premergeLockOfProject,
	projectRootOf,
	RECENT_FAILED_FILES,
	SuiteGrants,
} from "@stringsync/splates-server/server";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { fix } from "./fix";
import { PhaseTimer } from "./phases";
import { AgentPriority } from "./priority";
import { ROOT } from "./root";
import { refuseWholeSuite, test } from "./test";

export interface PremergeOptions {
	/** Run the eval harness's tests only. */
	evals?: boolean;
	/** Run the checks alone, without the lock or the tests: a merge's `preLock`. */
	checks?: boolean;
	/** Run the package's and the eval harness's tests together. */
	all?: boolean;
	log?: Logger;
	ps?: Ps;
}

/**
 * Runs what the merge gate runs: `dev fix`'s checks without writing fixes,
 * then the tests as `dev test --ci` runs them. Run by hand, it waits for the
 * project's premerge lock; an agent runs it only once the person approves.
 */
export async function premerge(opts: PremergeOptions): Promise<void> {
	const log = opts.log ?? new ConsoleLogger();
	const ps = opts.ps ?? new NodePs();
	if (opts.checks) {
		return await checkOnly(opts, log, ps);
	}
	if (ps.env(PREMERGE_HELD) !== undefined) {
		return await checkAndTest(opts, log);
	}
	// Refused before waiting on the lock, rather than once a gate lets it go.
	if (!opts.evals) {
		await refuseWholeSuite(ps, new SuiteGrants({ fs: new NodeFs(), ps }));
	}
	const lock = premergeLockOfProject({
		fs: new NodeFs(),
		ps,
		log,
		root: await projectRootOf(ps, ROOT),
	});
	log.info("premerge: waiting for the project's premerge lock");
	await lock.acquire();
	try {
		await checkAndTest(opts, log);
	} finally {
		await lock.release();
	}
}

/** The checks alone, as a merge runs them before it waits for the lock. */
async function checkOnly(
	_opts: PremergeOptions,
	log: Logger,
	ps: Ps,
): Promise<void> {
	await fix({
		check: true,
		log,
		ps,
		priority: new AgentPriority(ps, { premerge: true }),
	}).catch((error: unknown) => {
		log.error("premerge: the checks failed, so no tests ran");
		throw error;
	});
}

/**
 * What the checks a merge ran before the lock leave to do: nothing when the
 * tree is the commit they passed on, else biome and the type checker, which
 * a newer base can break, with scry's earlier result kept.
 */
async function checksLeft(ps: Ps): Promise<"all" | "none" | "code"> {
	const checked = ps.env(CHECKED_COMMIT);
	if (!checked) {
		return "all";
	}
	const head = await ps.spawnCapture(["git", "rev-parse", "HEAD"], {
		cwd: ROOT,
	});
	return head.stdout.trim() === checked ? "none" : "code";
}

/** The files still in the tree. */
async function existing(files: string[]): Promise<string[]> {
	const found = await Promise.all(
		files.map((file) =>
			access(join(ROOT, file)).then(
				() => file,
				() => null,
			),
		),
	);
	return found.filter((file) => file !== null);
}

async function checkAndTest(opts: PremergeOptions, log: Logger): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	const started = performance.now();
	// A premerge is the gate, or stands in for one under the lock: it keeps its priority.
	const priority = new AgentPriority(ps, { premerge: true });
	const phases = new PhaseTimer(ps);
	const left = await checksLeft(ps);
	if (left !== "none") {
		await fix({
			check: true,
			skipScry: left === "code",
			log,
			priority,
			phases,
			ps,
		}).catch((error: unknown) => {
			log.error("premerge: the checks failed, so no tests ran");
			throw error;
		});
	}
	// Files that failed recent gates run first, and stop the gate when they
	// fail again; every test still runs once.
	const recent = await existing(
		(ps.env(RECENT_FAILED_FILES) ?? "").split("\n").filter(Boolean),
	);
	// Passed, they ran in this gate already, so the whole run leaves them out.
	if (recent.length) {
		await phases.time("recent", () =>
			test({
				ci: true,
				allowed: true,
				bail: true,
				quiet: true,
				files: recent,
				log,
				priority,
				...(opts.all === undefined ? {} : { all: opts.all }),
				ps,
				deadline: Duration.ms(
					Math.max(1, PREMERGE_TIMEOUT_MS - (performance.now() - started)),
				),
			}),
		);
	}
	await test({
		ci: true,
		allowed: true,
		log,
		priority,
		phases,
		skip: recent,
		...(opts.evals === undefined ? {} : { evals: opts.evals }),
		...(opts.all === undefined ? {} : { all: opts.all }),
		...(opts.ps ? { ps: opts.ps } : {}),
		deadline: Duration.ms(
			Math.max(1, PREMERGE_TIMEOUT_MS - (performance.now() - started)),
		),
	});
}
