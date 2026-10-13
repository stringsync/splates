import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Snapshot } from "../snapshot";
import { scoped } from "./api";
import { LiveStream } from "./live-stream";

export type FeedEvents = { changed: undefined };

/**
 * The page's copy of the repo, refetched whenever the server says something
 * moved. Keep one for as long as the page: `start` opens the stream, `dispose`
 * closes it, and a disposed feed can be started again.
 */
export class Feed implements Eventful<FeedEvents>, Resource {
	private readonly dispatcher = new Dispatcher<FeedEvents>();
	readonly events = this.dispatcher.events;

	snapshot: Snapshot | null = null;
	/** Set once the stream drops, so a stale page says so instead of lying. */
	offline = false;
	/**
	 * What the server says when a newer arbor has moved the repo's records on,
	 * past what it understands: it refuses until it is updated.
	 */
	outdated: string | null = null;

	private stream: LiveStream | null = null;

	start(): void {
		// React runs a mount effect twice in StrictMode, and a second stream would
		// leak the first.
		if (this.stream !== null) {
			return;
		}
		this.stream = new LiveStream(scoped("/events"), {
			message: () => void this.load(),
			// Back after the stream dropped, what moved meanwhile was never said.
			open: (again) =>
				again ? void this.load() : this.set({ offline: false }),
			// The stream reconnects on its own, so this is a notice rather than
			// an error to recover from: `open` clears it when the server comes
			// back.
			error: () => this.set({ offline: true }),
		});
		void this.load();
	}

	dispose(): void {
		// Leaves the feed usable rather than spent: `useReactive` subscribes to
		// the instance it saw on its first render, so a feed rebuilt after a
		// remount would leave the page listening to the old one.
		this.stream?.dispose();
		this.stream = null;
	}

	private async load(): Promise<void> {
		try {
			const response = await fetch(scoped("/api/snapshot"));
			if (!response.ok) {
				const refusal = (await response.json().catch(() => null)) as {
					reason?: string;
					message?: string;
				} | null;
				if (refusal?.reason !== "outdated") {
					throw new Error(`snapshot: ${response.status}`);
				}
				this.set({ outdated: refusal.message ?? "", offline: false });
				return;
			}
			this.set({
				snapshot: (await response.json()) as Snapshot,
				offline: false,
				outdated: null,
			});
		} catch {
			// The last good snapshot stays on screen: a page that empties itself
			// because one poll failed is worse than one that admits it is stale.
			this.set({ offline: true });
		}
	}

	private set(
		next: Partial<Pick<Feed, "snapshot" | "offline" | "outdated">>,
	): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}
