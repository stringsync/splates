import { ConsoleLogger, type Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { fix } from "./fix";
import { test } from "./test";

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
 * fast, then the tests as `dev test --ci` runs them, on a runner when one can
 * be had and else here, so a merge never waits on the cloud. A failed check is
 * named apart from failed tests, for the gate's attribution.
 */
export async function premerge(opts: PremergeOptions): Promise<void> {
	const log = opts.log ?? new ConsoleLogger();
	await fix({ check: true, log, ...(opts.ps ? { ps: opts.ps } : {}) }).catch(
		(error: unknown) => {
			log.error("premerge: the checks failed, so no tests ran");
			throw error;
		},
	);
	await test({
		ci: true,
		orHere: true,
		log,
		...(opts.evals === undefined ? {} : { evals: opts.evals }),
		...(opts.all === undefined ? {} : { all: opts.all }),
		...(opts.ps ? { ps: opts.ps } : {}),
	});
}
