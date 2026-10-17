import type { ConversationHost } from "./conversation-host";

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
	const at = host.now();
	host.log.write({
		kind: "archive",
		archived,
		at,
		...(withConversation === undefined ? {} : { with: withConversation }),
	});
	await host.log.flush();
	host.set({
		archived,
		archivedAt: archived ? at : null,
		archivedWith: archived ? (withConversation ?? null) : null,
	});
}
