import type { ConversationState } from "@stringsync/splates-server/conversations";
import { useReactive } from "@webappwiz/react";
import { useEffect } from "react";
import type { ConversationFeed } from "./conversation-feed";
import { ThreadAction } from "./thread-action";

/** Keeps a loaded thread visible while its summary is refreshed. */
export function useThreadHistory(
	conversation: ConversationState,
	feed: ConversationFeed,
) {
	const { id, summary } = conversation;
	const failure = useReactive(feed.history, (history) => history.failure(id), [
		"changed",
	]);
	useEffect(() => {
		if (summary) {
			void feed.whole(id);
		}
	}, [feed, id, summary]);
	return {
		conversation: feed.history.shown(conversation),
		failure:
			summary && failure !== null ? (
				<div
					role="alert"
					className="flex flex-col items-center py-4 text-muted-foreground text-sm"
				>
					{failure}
					<ThreadAction outline onClick={() => void feed.whole(id)}>
						Retry history
					</ThreadAction>
				</div>
			) : null,
	};
}
