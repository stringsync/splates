/** `splates <verb> [subverb]` where a shell would run it. */
const SPLATES_COMMAND =
	/(?:^|[;&|(\n])\s*(?:[A-Z_][A-Z0-9_]*=(?:"(?:\\.|[^"\\])*"|'[^']*'|\S*)\s+)*(?:(?:nohup|exec)\s+|timeout\s+\S+\s+)*(?:(?:bunx|npx)\s+)?(?:\S*\/)?splates(?:@\S+)?\s+([a-z]+)(?:\s+([a-z]+))?(?=\s|$|[;&|)\n])/g;

/** `bin/evals run` (or `evals run`) where a shell would run it. */
const EVALS_RUN =
	/(?:^|[;&|(\n])\s*(?:[A-Z_][A-Z0-9_]*=(?:"(?:\\.|[^"\\])*"|'[^']*'|\S*)\s+)*(?:(?:nohup|exec)\s+|timeout\s+\S+\s+)*(?:\S*\/)?evals\s+run(?=\s|$|[;&|)\n])/;

/**
 * Whether `command` runs a splates wait command (`splates wait`, `splates task
 * wait`, `splates todo wait`, or `splates creds wait`) whose progress is shown
 * by its own wait event line.
 */
export function isWaitCommand(command: string | null): boolean {
	if (command === null) {
		return false;
	}
	for (const match of command.matchAll(SPLATES_COMMAND)) {
		const verb = match[1];
		const sub = match[2];
		if (
			verb === "wait" ||
			((verb === "task" || verb === "todo" || verb === "creds") &&
				sub === "wait")
		) {
			return true;
		}
	}
	return false;
}

/**
 * Whether `command` already renders its own dedicated card or live event line
 * in the thread (merge, eval run, signal wait/poll, or splates wait), so a
 * generic "Running in the background" line in the thread would duplicate it.
 */
export function hasOwnCard(command: string | null): boolean {
	if (command === null) {
		return false;
	}
	if (EVALS_RUN.test(command) || isWaitCommand(command)) {
		return true;
	}
	for (const match of command.matchAll(SPLATES_COMMAND)) {
		const verb = match[1];
		const sub = match[2];
		if (verb === "merge") {
			return true;
		}
		if (verb === "signal" && (sub === "wait" || sub === "poll")) {
			return true;
		}
	}
	return false;
}
