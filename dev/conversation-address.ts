import type { ConversationState } from "../conversations";
import type { AgentChoice } from "./conversation-feed";

/** What `#conversations/archived` opens: every archived conversation. */
export const ARCHIVED = "archived";
/**
 * In place of an id in the address: the screen that starts a conversation,
 * with the agent after it, as `new/codex`, else the agent last used, and
 * after that the task whose tree it starts in, as `new/codex/fix-upload`,
 * else the main tree.
 */
export const NEW = "new";

/**
 * The conversation a `#conversations/<id>` address names, `ARCHIVED` for the
 * archived ones, or null.
 */
export function conversationIn(hash: string): string | null {
	const [, id] = hash.match(/^#conversations\/(.+)$/) ?? [];
	return id ?? null;
}

/** Whether `open` is the screen that starts a conversation, with any agent. */
export function startsOne(open: string | null): boolean {
	return open === NEW || (open?.startsWith(`${NEW}/`) ?? false);
}

/**
 * The agent a new conversation starts with: the one `open` names, else the
 * newest conversation's, else the first.
 */
export function agentFor(
	open: string | null,
	agents: AgentChoice[],
	conversations: ConversationState[],
): string {
	const named = open?.startsWith(`${NEW}/`)
		? pathOf(open)
				.slice(NEW.length + 1)
				.split("/")[0]
		: null;
	return (
		agents.find((each) => each.id === named)?.id ??
		agents.find((each) => each.id === conversations[0]?.agent)?.id ??
		agents[0]?.id ??
		""
	);
}

/** The task a new conversation starts in, from `open`; null for the main tree. */
export function taskFor(open: string | null): string | null {
	return open?.startsWith(`${NEW}/`)
		? (pathOf(open)
				.slice(NEW.length + 1)
				.split("/")[1] ?? null)
		: null;
}

/** The model a new conversation starts on, `?model=` in `open`, or null. */
export function modelFor(open: string | null): string | null {
	const at = open?.indexOf("?") ?? -1;
	return open === null || at === -1
		? null
		: new URLSearchParams(open.slice(at + 1)).get("model");
}

/** `open` without its `?` and what follows. */
function pathOf(open: string): string {
	return open.split("?")[0] ?? open;
}
