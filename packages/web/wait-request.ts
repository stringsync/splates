/** An agent's `[SPLATES WAIT ...]` request, read from the end of its reply. */
export type WaitRequest =
	| { type: "task"; task: string }
	| { type: "idle"; duration: string };

const TRAILING =
	/(?:^|\n)\s*(\[SPLATES WAIT (?:task ([a-z0-9][a-z0-9-]*)|machine idle (\d+(?:ms|s|m|h)))\])\s*$/;

/** The reply without its trailing wait directive, and the wait it asked for; null when it asks none. */
export function waitIn(
	text: string,
): { body: string; directive: string; wait: WaitRequest } | null {
	const found = TRAILING.exec(text);
	if (found === null) {
		return null;
	}
	const [whole = "", directive = "", task, idle] = found;
	return {
		body: text.slice(0, text.length - whole.length).trimEnd(),
		directive,
		wait:
			task !== undefined
				? { type: "task", task }
				: { type: "idle", duration: idle ?? "" },
	};
}

/** What the server told the agent when the wait ended, or null while it has not. */
export function waitOutcome(reply: string | undefined): string | null {
	const head = "[SPLATES WAIT COMPLETE]";
	return reply?.startsWith(head) ? reply.slice(head.length).trim() : null;
}
