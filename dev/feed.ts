import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Snapshot } from "../snapshot";

export type FeedEvents = { changed: undefined };

/**
 * The page's copy of the repo, refetched whenever the server says something
 * moved.
 *
 * One of these lasts as long as the page: `start` and `dispose` open and close
 * the stream, and disposing leaves the object usable so it can be started
 * again, which is why the component reads it through `useReactive` rather than
 * rebuilding it, since that subscribes to the instance it saw on its first
 * render.
 */
export class Feed implements Eventful<FeedEvents>, Resource {
	private readonly dispatcher = new Dispatcher<FeedEvents>();
	readonly events = this.dispatcher.events;

	snapshot: Snapshot | null = null;
	/** Set once the stream drops, so a stale page says so instead of lying. */
	offline = false;

	private stream: EventSource | null = null;

	start(): void {
		// React runs a mount effect twice in StrictMode, and a second stream would
		// leak the first.
		if (this.stream !== null) {
			return;
		}
		const stream = new EventSource("/events");
		this.stream = stream;
		stream.onmessage = () => void this.load();
		stream.onopen = () => this.set({ offline: false });
		// EventSource reconnects on its own, so this is a notice rather than an
		// error to recover from: `onopen` clears it when the server comes back.
		stream.onerror = () => this.set({ offline: true });
		void this.load();
	}

	dispose(): void {
		this.stream?.close();
		this.stream = null;
	}

	private async load(): Promise<void> {
		try {
			const response = await fetch("/api/snapshot");
			if (!response.ok) {
				throw new Error(`snapshot: ${response.status}`);
			}
			this.set({
				snapshot: (await response.json()) as Snapshot,
				offline: false,
			});
		} catch {
			// The last good snapshot stays on screen: a page that empties itself
			// because one poll failed is worse than one that admits it is stale.
			this.set({ offline: true });
		}
	}

	private set(next: Partial<Pick<Feed, "snapshot" | "offline">>): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}
