import type { Conversation } from "./conversation";
import type { ConversationHost } from "./host";

/** Records archive membership and its timestamp together. */
export async function put(
	host: ConversationHost,
	{
		archived,
		with: withConversation,
	}: {
		archived: boolean;
		with?: string | undefined;
	},
): Promise<void> {
	if (host.state.archived === archived) {
		return;
	}
	const now = host.now();
	host.log.write({
		kind: "archive",
		archived,
		at: now,
		...(withConversation === undefined ? {} : { with: withConversation }),
	});
	await host.log.flush();
	host.set({
		archived,
		archivedAt: archived ? now : null,
		archivedWith: archived ? (withConversation ?? null) : null,
	});
}

/** The archived of `conversations`, the latest archived first. */
export function archivedNewestFirst(
	conversations: readonly Conversation[],
): Conversation[] {
	return conversations
		.filter((each) => each.state.archived)
		.toSorted((one, other) =>
			(other.archivedSince ?? "").localeCompare(one.archivedSince ?? ""),
		);
}
