import { type JSX, useMemo } from "react";
import { CheckpointProvider } from "./checkpoint";
import type { ConversationFeed } from "./conversation-feed";
import { useConversationIndex } from "./conversation-index";

/** Offers checkpoint and restart controls for the feed's active conversations. */
export function ConversationCheckpoint({
	feed,
	...props
}: Omit<Parameters<typeof CheckpointProvider>[0], "conversations"> & {
	feed: ConversationFeed;
}): JSX.Element {
	const conversations = useConversationIndex(feed);
	const active = useMemo(
		() => conversations.filter((each) => !each.archived),
		[conversations],
	);
	return <CheckpointProvider {...props} conversations={active} />;
}
