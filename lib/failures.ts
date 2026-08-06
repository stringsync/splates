import type { Middleware } from "@webappwiz/cmd";
import { Dispatcher } from "@webappwiz/events";
import type { Logger } from "@webappwiz/log";
import { EXIT, Exit, type Reason } from "./exit";

/** Why a command refused, in the form its caller can act on. */
export interface Failure {
	reason: Reason;
	message: string;
	data: Record<string, unknown>;
}

/**
 * How a command refuses. Raises `fail` for whoever is listening, then throws:
 * a listener can decide what a failure looks like, but it cannot stop the
 * command that raised it, and every call site here means "and go no further".
 *
 * Commands take this as its own annotated parameter rather than as part of a
 * destructured bag. A `never`-returning call only ends control flow when its
 * target has an explicit type, and folding it in silently costs the narrowing
 * that every `if (!x) { fail(...) }` below depends on.
 */
export class Failures extends Dispatcher<{ fail: Failure }> {
	fail(
		reason: Reason,
		message: string,
		data: Record<string, unknown> = {},
	): never {
		this.dispatch("fail", { reason, message, data });
		throw new Exit(EXIT[reason], reason);
	}
}

/**
 * Gives the action somewhere to refuse, and decides what a refusal looks like:
 * a machine-readable reason on stdout, a human explanation on stderr. An agent
 * branches on the first and reads the second.
 */
export function failures<C extends object>(
	log: Logger,
): Middleware<C, C & { failures: Failures }> {
	return async (ctx, next) => {
		const failures = new Failures();
		failures.events.on("fail", ({ reason, message, data }) => {
			log.info(JSON.stringify({ reason, ...data }));
			log.error(message);
		});
		try {
			await next({ ...ctx, failures });
		} finally {
			failures.dispose();
		}
	};
}
