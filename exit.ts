import type { Ctx } from "./context";

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
 * Thrown after `ps.exit` so the command body stops unwinding. Under NodePs the
 * process is already gone; under FakePs (tests) this is what ends the call.
 */
export class Exit extends Error {
	constructor(
		readonly code: number,
		readonly reason: Reason,
	) {
		super(reason);
	}
}

/** Machine-readable reason on stdout, human explanation on stderr. */
export function fail(
	ctx: Ctx,
	reason: Reason,
	message: string,
	data: Record<string, unknown> = {},
): never {
	ctx.log.info(JSON.stringify({ reason, ...data }));
	ctx.log.error(message);
	ctx.ps.exit(EXIT[reason]);
	throw new Exit(EXIT[reason], reason);
}
