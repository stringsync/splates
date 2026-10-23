import {
	PREMERGE_HELD,
	PREMERGE_TIMEOUT_MS,
	premergeLockOfMachine,
	SuiteGrants,
} from "@stringsync/splates-server/server";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { fix } from "./fix";
import { refuseWholeSuite, test } from "./test";

export interface PremergeOptions {
	/** Run the eval harness's tests only. */
	evals?: boolean;
	/** Run the package's and the eval harness's tests together. */
	all?: boolean;
	log?: Logger;
	ps?: Ps;
}

/**
 * What the merge gate runs: `dev fix`'s checks without writing fixes, failing
 * fast, then the tests as `dev test --ci` runs them. A failed check is named
 * apart from failed tests, for the gate's attribution. Run by hand, it waits
 * for the machine's premerge lock, so the whole suite runs one at a time;
 * inside a gate, which holds it already, it runs at once. An agent runs it
 * by hand only once the person approves, as the whole suite. Its tests are
 * stopped once it has run `PREMERGE_TIMEOUT_MS`, as the gate kills it then.
 */
export async function premerge(opts: PremergeOptions): Promise<void> {
	const log = opts.log ?? new ConsoleLogger();
	const ps = opts.ps ?? new NodePs();
	if (ps.env(PREMERGE_HELD) !== undefined) {
		return await checkAndTest(opts, log);
	}
	// Refused before waiting on the lock, rather than once a gate lets it go.
	if (!opts.evals) {
		await refuseWholeSuite(ps, new SuiteGrants({ fs: new NodeFs(), ps }));
	}
	const lock = premergeLockOfMachine({ fs: new NodeFs(), ps, log });
	log.info("premerge: waiting for the machine's premerge lock");
	await lock.acquire();
	try {
		await checkAndTest(opts, log);
	} finally {
		await lock.release();
	}
}

async function checkAndTest(opts: PremergeOptions, log: Logger): Promise<void> {
	const started = performance.now();
	await fix({ check: true, log, ...(opts.ps ? { ps: opts.ps } : {}) }).catch(
		(error: unknown) => {
			log.error("premerge: the checks failed, so no tests ran");
			throw error;
		},
	);
	await test({
		ci: true,
		allowed: true,
		log,
		...(opts.evals === undefined ? {} : { evals: opts.evals }),
		...(opts.all === undefined ? {} : { all: opts.all }),
		...(opts.ps ? { ps: opts.ps } : {}),
		deadline: Duration.ms(
			Math.max(1, PREMERGE_TIMEOUT_MS - (performance.now() - started)),
		),
	});
}
