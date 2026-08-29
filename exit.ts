import type { Deps, Middleware } from "webappwiz/cmd";

/** Exit codes are the API: an agent branches on these, not on prose. */
export const EXIT = {
	// Stable by contract: keep them as they are, and keep README.md's table in
	// sync.
	usage: 1,
	conflict: 2,
	tests_failed: 3,
	lease_lost: 4,
	budget_exhausted: 5,
	lease_held: 6,
	dirty: 7,
	not_found: 8,
	hook_failed: 9,
	exists: 10,
	orphaned: 11,
	merge_failed: 12,
	already_removed: 13,
	timeout: 14,
} as const;

export type Reason = keyof typeof EXIT;

/**
 * A refusal, carrying the reason to branch on, a message to show, and any
 * data worth reporting with it. `exits` turns one into output and a status
 * code.
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
 * Decides what a refusal looks like (a machine-readable reason on stdout, a
 * human explanation on stderr) and is the only place that ends the process.
 * An agent branches on the first and reads the second.
 */
export function exits<C extends Deps>(): Middleware<C> {
	return async (ctx, next) => {
		try {
			await next(ctx);
		} catch (e) {
			if (!(e instanceof Exit)) {
				throw e;
			}
			ctx.log.info(JSON.stringify({ reason: e.reason, ...e.data }));
			ctx.log.error(e.message);
			ctx.ps.exit(EXIT[e.reason]);
		}
	};
}
