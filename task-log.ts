import type { Fs } from "webappwiz/system";
import type { Entry } from "./conversation-log";
import {
	blank,
	type ConversationState,
	type Usage,
} from "./conversation-state";
import { agentTurn, fold, tally } from "./fold";
import { PLAN_FILE } from "./plan";

/** What a task's turns used, apart from the rest of its conversation's. */
export interface TaskUsage {
	/** Tokens read, those from cache among them. */
	input: number;
	cached: number;
	output: number;
	/** What it cost; null for an agent that never says, as Codex does not. */
	cost: { amount: number; currency: string } | null;
}

/** What a task's stretch of its conversation shows of how the work went. */
export interface TaskLog {
	/** OpenCode observations have different scope; kept in the conversation, not legacy task totals. */
	usage: TaskUsage | undefined;
	/** Each agent turn's span, start to last move, summed. */
	workedMs: number;
	/** When the person stopped the agent's turn, each time. */
	stopped: string[];
	/** When a lost connection cut the agent's turn short, each time. */
	interrupted: string[];
	/** How many times each command failed. */
	failedCommands: Record<string, number>;
	/** Lines the agent's edits took out and put in, its plan's aside. */
	editedLines: number;
}

/**
 * Reads the conversation logged at `log` from `since` to `until`: a
 * conversation can outlive the task, or come to it already under way. Null
 * when there is no such log. Read raw rather than replayed, since the agent
 * merging is still writing it.
 */
export async function taskLog(
	log: string,
	fs: Fs,
	since: string,
	until: string,
): Promise<TaskLog | null> {
	const entries = (await fs.read(log).catch(() => ""))
		.split("\n")
		.flatMap((line) => {
			try {
				return line ? [JSON.parse(line) as Entry] : [];
			} catch {
				return [];
			}
		});
	const start = entries[0];
	if (start?.kind !== "start") {
		return null;
	}
	const state = blank(start.id, start.agent, start.task, start.createdAt);
	// The usage the conversation had run up as the task began. Usage lines
	// say no time, so each falls on the last time a line said.
	let before: Usage | null = null;
	for (const entry of entries) {
		const at = "at" in entry && typeof entry.at === "string" ? entry.at : null;
		if (at !== null && at > until) {
			break;
		}
		if (before === null && at !== null && at >= since) {
			before = structuredClone(state.usage);
		}
		if (entry.kind === "update") {
			fold(state, entry.update, at);
		} else if (entry.kind === "usage") {
			tally(state, entry.usage);
		} else if (entry.kind === "stopped") {
			agentTurn(state, entry.at).stopped = entry.at;
		} else if (entry.kind === "interrupted") {
			agentTurn(state, entry.at).interrupted = entry.at;
		} else if (entry.kind === "prompt" && !entry.queued) {
			// Its words stand for nothing here, but the next turn starts after them.
			state.messages.push({
				role: "user",
				parts: [],
				plan: null,
				at,
				until: at,
			});
		}
	}
	return summed(state, before ?? state.usage, since);
}

function summed(
	state: ConversationState,
	before: Usage,
	since: string,
): TaskLog {
	const after = state.usage;
	const result: TaskLog = {
		usage:
			state.agent === "opencode"
				? undefined
				: {
						input: after.input - before.input,
						cached: after.cached - before.cached,
						output: after.output - before.output,
						cost:
							after.cost === null
								? null
								: {
										amount: after.cost.amount - (before.cost?.amount ?? 0),
										currency: after.cost.currency,
									},
					},
		workedMs: 0,
		stopped: [],
		interrupted: [],
		failedCommands: {},
		editedLines: 0,
	};
	for (const message of state.messages) {
		if (message.stopped !== undefined && message.stopped >= since) {
			result.stopped.push(message.stopped);
		}
		if (message.interrupted !== undefined && message.interrupted >= since) {
			result.interrupted.push(message.interrupted);
		}
		if (message.role !== "agent" || message.at === null) {
			continue;
		}
		if (message.until !== null && message.until > since) {
			result.workedMs += Math.max(
				0,
				Date.parse(message.until) -
					Date.parse(message.at < since ? since : message.at),
			);
		}
		for (const part of message.parts) {
			if (part.type !== "tool" || part.at === null || part.at < since) {
				continue;
			}
			if (part.status === "failed" && part.command !== null) {
				result.failedCommands[part.command] =
					(result.failedCommands[part.command] ?? 0) + 1;
			}
			for (const edit of part.edits) {
				if (!edit.path.endsWith(`/${PLAN_FILE}`)) {
					result.editedLines += lines(edit.old) + lines(edit.new);
				}
			}
		}
	}
	return result;
}

function lines(text: string | null): number {
	return text === null || text === "" ? 0 : text.split("\n").length;
}
