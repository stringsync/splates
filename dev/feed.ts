import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { Snapshot } from "../snapshot";
import { scoped } from "./api";
import { LiveStream } from "./live-stream";

export type FeedEvents = { changed: undefined };

/**
 * How long the server stays unreachable before the page says it is offline.
 * A stream through a tunnel drops and reconnects within seconds, and saying
 * so for each blip would cry wolf.
 */
export const OFFLINE_AFTER = Duration.secs(10);

/**
 * The page's copy of the repo, refetched whenever the server says something
 * moved. Keep one for as long as the page: `start` opens the stream, `dispose`
 * closes it, and a disposed feed can be started again.
 */
export class Feed implements Eventful<FeedEvents>, Resource {
	private readonly dispatcher = new Dispatcher<FeedEvents>();
	readonly events = this.dispatcher.events;

	snapshot: Snapshot | null = null;
	/**
	 * Set once the server has stayed unreachable for `offlineAfter`, so a
	 * stale page says so instead of lying.
	 */
	offline = false;
	/**
	 * What the server says when a newer arbor has moved the repo's records on,
	 * past what it understands: it refuses until it is updated.
	 */
	outdated: string | null = null;

	private stream: LiveStream | null = null;
	/** Counting down to `offline` while the server is unreachable. */
	private unreachable: Resource | null = null;

	constructor(
		private readonly offlineAfter: Duration = OFFLINE_AFTER,
		private readonly timer: Timer = new SystemTimer(),
	) {}

	start(): void {
		// React runs a mount effect twice in StrictMode, and a second stream would
		// leak the first.
		if (this.stream !== null) {
			return;
		}
		this.stream = new LiveStream(scoped("/events"), {
			message: () => void this.load(),
			// Back after the stream dropped, what moved meanwhile was never said.
			open: (again) => (again ? void this.load() : this.reached({})),
			// The stream reconnects on its own, so this is a notice rather than
			// an error to recover from: `open` clears it when the server comes
			// back.
			error: () => this.lost(),
		});
		void this.load();
	}

	dispose(): void {
		// Leaves the feed usable rather than spent: `useReactive` subscribes to
		// the instance it saw on its first render, so a feed rebuilt after a
		// remount would leave the page listening to the old one.
		this.stream?.dispose();
		this.stream = null;
		this.unreachable?.dispose();
		this.unreachable = null;
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
				this.reached({ outdated: refusal.message ?? "" });
				return;
			}
			this.reached({
				snapshot: (await response.json()) as Snapshot,
				outdated: null,
			});
		} catch {
			// The last good snapshot stays on screen: a page that empties itself
			// because one poll failed is worse than one that admits it is stale.
			this.lost();
		}
	}

	/** Starts counting down to `offline`, unless already counting. */
	private lost(): void {
		if (this.offline || this.unreachable !== null) {
			return;
		}
		this.unreachable = this.timer.setTimeout(() => {
			this.unreachable = null;
			this.set({ offline: true });
		}, this.offlineAfter);
	}

	/** The server answered with `next`: the countdown to `offline` stops. */
	private reached(next: Partial<Pick<Feed, "snapshot" | "outdated">>): void {
		this.unreachable?.dispose();
		this.unreachable = null;
		this.set({ ...next, offline: false });
	}

	private set(
		next: Partial<Pick<Feed, "snapshot" | "offline" | "outdated">>,
	): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}
