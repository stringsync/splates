import type { Middleware } from "@webappwiz/cmd";
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
 * Thrown by `Failures.fail` to stop the command that raised it. The process
 * boundary catches this and exits with `code`; a test catches it and reads
 * `reason`.
 */
export class Exit extends Error {
	constructor(
		readonly code: number,
		readonly reason: Reason,
	) {
		super(reason);
	}
}

/**
 * Turns a refusal into the process's exit code. The command has already said
 * why it stopped, so there is nothing left to print — and this is the only
 * place that decides how the process ends.
 */
export function exits<C extends object>(ps: Ps): Middleware<C> {
	return async (ctx, next) => {
		try {
			await next(ctx);
		} catch (e) {
			if (!(e instanceof Exit)) {
				throw e;
			}
			ps.exit(e.code);
		}
	};
}
