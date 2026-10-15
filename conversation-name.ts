import type { ConversationState } from "./conversations";
import type { LaneRecord } from "./lanes";
import { leadingDirectives, UNTRIAGED } from "./prompts";

/**
 * What a conversation goes by: the name the person gave it, else the task its
 * agent holds, so it follows the agent from task to task, or held last, so a
 * finished task keeps its name until the agent takes another, else the lanes
 * it was started on, so an orchestrator's follows a lane's renames, else the
 * agent's title. Until it has one, a stand-in (see `unnamed`): the first line
 * of what the person first said, else "Not started".
 */
export function nameOf(
	conversation: ConversationState,
	lanes: readonly LaneRecord[],
): string {
	return (
		conversation.name ??
		conversation.lastTask ??
		lanesNamed(conversation, lanes) ??
		conversation.title ??
		openingOf(conversation) ??
		"Not started"
	);
}

/**
 * The names of the lanes a conversation opened with `[ARBOR LANE <n>]` for,
 * as an orchestrator's does, or null for any other: "Untriaged" for the
 * untriaged todos, and a lane no longer on the board by its number.
 */
function lanesNamed(
	conversation: ConversationState,
	lanes: readonly LaneRecord[],
): string | null {
	const named = lanesOf(conversation).map((argument) =>
		argument === UNTRIAGED
			? "Untriaged"
			: (lanes.find((lane) => String(lane.id) === argument)?.name ??
				`Lane ${argument}`),
	);
	return named.length === 0 ? null : named.join(", ");
}

/** What each `[ARBOR LANE ...]` the person's first words start with names. */
export function lanesOf(conversation: ConversationState): string[] {
	const first = conversation.messages
		.find((message) => message.role === "user")
		?.parts.find((part) => part.type === "text");
	return first?.type === "text"
		? leadingDirectives(first.text).directives.flatMap((directive) => {
				const lane = /^\[ARBOR LANE (\S+)\]$/.exec(directive)?.[1];
				return lane === undefined ? [] : [lane];
			})
		: [];
}

/** The first line the person said in a conversation, or null before they say any. */
export function openingOf(conversation: ConversationState): string | null {
	for (const message of conversation.messages) {
		if (message.role !== "user") {
			continue;
		}
		for (const part of message.parts) {
			const line = part.type === "text" ? part.text.trim().split("\n")[0] : "";
			if (line) {
				return line;
			}
		}
	}
	return null;
}
