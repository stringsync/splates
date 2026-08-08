import type { Middleware } from "@webappwiz/cmd";
import type { Logger } from "@webappwiz/log";
import type { Ps } from "@webappwiz/sys";

/**
 * Exit codes are the API: an agent branches on these, not on prose. Keep them
 * stable, and keep README.md's table in sync.
 */
export const EXIT = {
	usage: 1,
	conflict: 2,
	tests_failed: 3,
	lease_lost: 4,
	budget_exhausted: 5,
	lease_live: 6,
	dirty: 7,
	not_found: 8,
	hook_failed: 9,
	exists: 10,
	orphaned: 11,
	merge_failed: 12,
	already_pruned: 13,
} as const;

export type Reason = keyof typeof EXIT;

/**
 * A refusal, carrying everything anyone needs to act on it: `exits` turns it
 * into output and a status code, a test reads its fields directly.
 */
export class Exit extends Error {
	constructor(
		readonly reason: Reason,
		message: string,
		readonly data: Record<string, unknown> = {},
	) {
		super(message);
	}
}

/**
 * How a command refuses. Every call site means "and go no further", which is
 * what the `never` return buys: the code below a `fail` is unreachable, and
 * TypeScript narrows accordingly.
 */
export function fail(
	reason: Reason,
	message: string,
	data: Record<string, unknown> = {},
): never {
	throw new Exit(reason, message, data);
}

/**
 * Decides what a refusal looks like — a machine-readable reason on stdout, a
 * human explanation on stderr — and is the only place that ends the process.
 * An agent branches on the first and reads the second.
 */
export function exits<C extends object>(ps: Ps, log: Logger): Middleware<C> {
	return async (ctx, next) => {
		try {
			await next(ctx);
		} catch (e) {
			if (!(e instanceof Exit)) {
				throw e;
			}
			log.info(JSON.stringify({ reason: e.reason, ...e.data }));
			log.error(e.message);
			ps.exit(EXIT[e.reason]);
		}
	};
}
