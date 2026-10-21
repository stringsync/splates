import type * as acp from "@agentclientprotocol/sdk";
import { CHECKPOINT } from "../plans";
import type { ConversationHost, Lift, Route } from "./host";
import { textOf } from "./messages";
import type { Message } from "./state";

// What is judged of what the person says before the agent reads it: Auto
// pick's second look and the note pointers. Neither ever holds the message
// back: one that fails leaves it as it was.

/**
 * Lets Auto pick look again at what the person says in `messages`, in a
 * conversation it started, before the agent reads them; one that fails
 * moves nothing.
 */
export async function lifted(
	lift: Lift | null | undefined,
	host: ConversationHost,
	messages: readonly Message[],
): Promise<void> {
	const said = messages.filter((each) => each.told === undefined);
	if (lift == null || said.length === 0 || host.state.autoPick === null) {
		return;
	}
	await lift(host, said).catch(() => {});
}

/**
 * The note pointers for what the person says in `messages`, before the
 * agent reads them; null for none, or a route that fails.
 */
export async function pointersFor(
	route: Route | null | undefined,
	host: ConversationHost,
	messages: readonly Message[],
): Promise<string | null> {
	const said = messages.filter(
		(each) => each.told === undefined && textOf(each) !== CHECKPOINT,
	);
	if (route == null || said.length === 0) {
		return null;
	}
	return route(host, said).catch(() => null);
}

/** `content` with `pointers` after it, as a block of their own. */
export function pointed(
	content: acp.ContentBlock[],
	pointers: string | null,
): acp.ContentBlock[] {
	return pointers === null
		? content
		: [...content, { type: "text", text: pointers }];
}
