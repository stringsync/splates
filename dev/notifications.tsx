import { useReactive } from "@webappwiz/react";
import { useEffect, useRef, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import type { Needing } from "../needs";
import { keyOf } from "../notices";
import type { Details } from "../show";
import { openedBy } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { useNameOf } from "./conversation-names";
import { rowsOf } from "./conversation-rows";
import { Notifier } from "./notifier";
import { syncPush } from "./push";
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
 * the service worker passes back opens its row too. While this device is
 * subscribed to the server's pushes, they show the notifications instead, so
 * a phone that froze the page still hears.
 */
export function useNotifier(
	settings: Settings,
	rows: Needing[],
	name: (row: Needing) => string,
	open: (row: Needing) => void,
): void {
	const [notifier] = useState(() => new Notifier(settings));
	const pushing = useRef(false);
	const look = useRef(() => {});
	look.current = () =>
		notifier.show(notifier.look(rows, name, Date.now()), open, pushing.current);
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
		// One at a time, so a quick on and off ends as the last one says.
		let syncing = Promise.resolve();
		const sync = () => {
			syncing = syncing
				.then(() => syncPush(settings))
				.then((subscribed) => {
					pushing.current = subscribed;
				});
		};
		sync();
		return settings.events.on("changed", sync);
	}, [settings]);
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
