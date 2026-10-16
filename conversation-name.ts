import type { ConversationState } from "./conversations";
import type { LaneRecord } from "./lanes";
import { leadingDirectives, UNTRIAGED } from "./prompts";

/**
 * What a conversation goes by: its real name (see `realName`), else a
 * stand-in until it has one: the first line of what the person first said,
 * else "Not started".
 */
export function nameOf(
	conversation: ConversationState,
	lanes: readonly LaneRecord[],
): string {
	return (
		realName(conversation, lanes) ?? openingOf(conversation) ?? "Not started"
	);
}

/**
 * The name a conversation has earned, or null: the name the person gave it,
 * else the lanes it was started on, so an orchestrator's follows a lane's
 * renames and keeps them through a todo it does itself, else the task its
 * agent holds, so it follows the agent from task to task, or held last, so a
 * finished task keeps its name until the agent takes another, else the
 * agent's title.
 */
export function realName(
	conversation: ConversationState,
	lanes: readonly LaneRecord[],
): string | null {
	return (
		conversation.name ??
		lanesNamed(conversation, lanes) ??
		conversation.lastTask ??
		conversation.title
	);
}

/**
 * The names of the lanes a conversation opened with `[ARBOR LANE <n>]` for,
 * as an orchestrator's does, or null for any other: "Untriaged" for the
 * untriaged todos, and a lane `lanes` lacks by its number.
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

/**
 * Whether a conversation goes by the task its agent holds or held last, as
 * `nameOf` names it.
 */
export function namedForTask(conversation: ConversationState): boolean {
	return (
		conversation.lastTask !== null &&
		(conversation.name === null
			? lanesOf(conversation).length === 0
			: conversation.name === conversation.lastTask)
	);
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
