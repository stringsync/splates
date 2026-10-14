import { useReactive } from "@webappwiz/react";
import { useEffect, useRef, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import type { Needing } from "../needs";
import type { Details } from "../show";
import type { ConversationFeed } from "./conversation-feed";
import { useNameOf } from "./conversation-names";
import { openedBy, rowsOf } from "./conversation-rows";
import { keyOf, Notifier } from "./notifier";
import type { Settings } from "./settings";
import type { Opened } from "./worker";

/**
 * Notifies the person, as `settings` say, of what the agents in `feed` and
 * `tasks` did since the last look, each opening its conversation with
 * `onOpen` when clicked. It shows nothing itself, so it can run on every
 * screen, a phone's included, whatever the page shows.
 */
export function Notifications({
	feed,
	tasks,
	settings,
	onOpen,
}: {
	feed: ConversationFeed;
	tasks: Details[];
	settings: Settings;
	onOpen: (id: string) => void;
}): null {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	const nameOf = useNameOf();
	useNotifier(
		settings,
		rowsOf(tasks, conversations),
		(row) =>
			(row.conversation ? nameOf(row.conversation) : row.task?.task) ?? "",
		(row) => onOpen(openedBy(row)),
	);
	return null;
}

/**
 * Notifies the person, as `settings` say, of what `rows`, named by `name`,
 * did since the last look, each opening its row with `open`: looked at again
 * as they change, and every half minute for the ones that go quiet. A click
 * the service worker passes back opens its row too.
 */
export function useNotifier(
	settings: Settings,
	rows: Needing[],
	name: (row: Needing) => string,
	open: (row: Needing) => void,
): void {
	const [notifier] = useState(() => new Notifier(settings));
	const look = useRef(() => {});
	look.current = () =>
		notifier.show(notifier.look(rows, name, Date.now()), open);
	// The latest, for the listener below, which outlives a render.
	const opened = useRef((_key: string) => {});
	opened.current = (key) => {
		const row = rows.find((each) => keyOf(each) === key);
		if (row !== undefined) {
			open(row);
		}
	};
	useEffect(() => look.current());
	useEffect(() => {
		const tick = new SystemTimer().setInterval(
			() => look.current(),
			Duration.secs(30),
		);
		return () => tick.dispose();
	}, []);
	useEffect(() => {
		const workers = navigator.serviceWorker;
		if (workers === undefined) {
			return;
		}
		const heard = (event: MessageEvent<Opened>) => {
			if (event.data?.type === "arbor:open") {
				opened.current(event.data.key);
			}
		};
		workers.addEventListener("message", heard);
		return () => workers.removeEventListener("message", heard);
	}, []);
}
