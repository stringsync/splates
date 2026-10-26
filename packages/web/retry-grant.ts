import { RETRIED } from "@stringsync/splates-server/plans/browser";
import { retryTask } from "./api";
import type { Reply } from "./card-reply";

/**
 * `splates retry` for `task` from the page, then `[SPLATES RETRIED]` to the
 * conversation's agent, so it merges again without the person typing:
 * the grant is the person's, never the agent's, so the page makes it rather
 * than allowing the agent to run it. With no agent to tell, as for an
 * external one, the grant alone.
 */
export async function grantRetry(
	task: string,
	send: Reply["send"],
	note = "",
): Promise<void> {
	await retryTask(task);
	try {
		await send?.(
			note.trim() === ""
				? RETRIED
				: `${RETRIED}\n\n> **Anything else?**\n\n${note.trim()}`,
		);
	} catch (error) {
		throw new Untold(error);
	}
}

/**
 * The attempts were granted but the agent was not told, so the grant stands
 * and only the telling failed: a control shows it granted, not taken back.
 */
export class Untold extends Error {
	constructor(cause: unknown) {
		super(
			`granted, but the agent was not told: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
}
