import type { ConversationState } from "@stringsync/splates-server/conversations";
import { useReactive } from "@webappwiz/react";
import { useEffect } from "react";
import { Alert, AlertDescription } from "#web/components/ui/alert.tsx";
import { Button } from "#web/components/ui/button.tsx";
import type { ConversationFeed } from "./conversation-feed";

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
				<Alert>
					<AlertDescription>{failure}</AlertDescription>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void feed.whole(id)}
					>
						Retry history
					</Button>
				</Alert>
			) : null,
	};
}
