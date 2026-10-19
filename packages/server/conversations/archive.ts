import type { ConversationHost } from "./host";

/**
 * Records archive membership and its timestamp together; `rest`, archived
 * resting, as a persistent agent's run that ended with its role still on.
 */
export async function put(
	host: ConversationHost,
	{
		archived,
		with: withConversation,
		rest = false,
	}: {
		archived: boolean;
		with?: string | undefined;
		rest?: boolean;
	},
): Promise<void> {
	const resting = archived && rest;
	if (
		host.state.archived === archived &&
		(host.state.resting ?? false) === resting
	) {
		return;
	}
	// Retired from resting, it keeps when it was archived.
	const at = host.state.archived && archived ? host.state.archivedAt : null;
	const now = at ?? host.now();
	host.log.write({
		kind: "archive",
		archived,
		at: now,
		...(withConversation === undefined ? {} : { with: withConversation }),
		...(resting ? { rest: true } : {}),
	});
	await host.log.flush();
	host.set({
		archived,
		archivedAt: archived ? now : null,
		archivedWith: archived ? (withConversation ?? null) : null,
		resting,
	});
}
