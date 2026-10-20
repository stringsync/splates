import type { Details } from "@stringsync/splates-server/tasks";
import { useEffect, useRef, useState } from "react";
import { NEW, TASK } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { Visits } from "./visits";

/**
 * Back through the conversations the page opened and forward, as in a
 * browser's history, past any since archived or merged away: `open` is the
 * one open now, and `go` opens another.
 */
export function usePageVisits({
	open,
	tasks,
	feed,
	go,
}: {
	open: string | null;
	tasks: Details[];
	feed: ConversationFeed;
	go: (conversation: string) => void;
}): { back: () => void; forward: () => void } {
	const [visits] = useState(() => new Visits());
	useEffect(() => {
		if (open === null || open === NEW) {
			visits.leave();
		} else {
			visits.visit(open);
		}
	}, [open, visits]);
	// Read as the person goes, so by what the page holds then.
	const exists = useRef<(id: string) => boolean>(() => false);
	exists.current = (id: string) =>
		id.startsWith(TASK)
			? tasks.some(({ task }) => `${TASK}${task}` === id)
			: feed.conversations.some((each) => each.id === id && !each.archived);
	const visit = (to: string | null) => {
		if (to !== null) {
			go(to);
		}
	};
	return {
		back: () => visit(visits.back(exists.current)),
		forward: () => visit(visits.forward(exists.current)),
	};
}
