import type { TaskRecord } from "@stringsync/splates-server/board";
import type { Needing } from "@stringsync/splates-server/plans";
import { keyOf } from "@stringsync/splates-server/push/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { openedBy } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { useNameOf } from "./conversation-names";
import { rowsOf } from "./conversation-rows";
import { Notifier } from "./notifier";
import { syncPush } from "./push";
import { refusalOf } from "./refusal";
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
	todos,
	settings,
	onOpen,
}: {
	feed: ConversationFeed;
	tasks: Details[];
	todos: TaskRecord[];
	settings: Settings;
	onOpen: (id: string) => void;
}): JSX.Element | null {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	const nameOf = useNameOf();
	const refusal = useNotifier(
		settings,
		rowsOf(tasks, conversations, todos),
		(row) =>
			(row.conversation ? nameOf(row.conversation) : row.task?.task) ?? "",
		(row) => onOpen(openedBy(row)),
	);
	// Said apart from any page, as the switch that failed may be on none now.
	return refusal === null ? null : (
		<p
			role="alert"
			className="fixed right-4 bottom-4 z-50 rounded-lg border bg-card px-3 py-2 text-destructive text-sm shadow-md"
		>
			{refusal}
		</p>
	);
}

/**
 * Notifies you, as `settings` say, of what `rows` did since the last look,
 * titled by `name`; clicking one runs `open` on its row. Returns why
 * subscribing to the server's pushes failed, or null, so the page can say
 * why it only notifies while open.
 */
export function useNotifier(
	settings: Settings,
	rows: Needing[],
	name: (row: Needing) => string,
	open: (row: Needing) => void,
): string | null {
	// Rows are looked at again as they change, and every half minute for the
	// ones that go quiet. While this device is subscribed to the server's
	// pushes, they show the notifications instead, so a phone that froze the
	// page still hears; a click the service worker passes back opens its row.
	const [refusal, setRefusal] = useState<string | null>(null);
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
				.then(
					(subscribed) => {
						pushing.current = subscribed;
						setRefusal(null);
					},
					(error: unknown) => {
						pushing.current = false;
						// The page notifies while open, so the switch stays on, saying why not more.
						if (settings.get("notifications.on")) {
							setRefusal(refusalOf("Pushes not set up", error));
						}
					},
				);
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
			if (event.data?.type === "splates:open") {
				opened.current(event.data.key);
			}
		};
		workers.addEventListener("message", heard);
		return () => workers.removeEventListener("message", heard);
	}, []);
	return refusal;
}
