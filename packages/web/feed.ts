import type { Snapshot } from "@stringsync/splates-server/snapshot";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import { scoped } from "./api";
import type { SnapshotExpecter } from "./expecting";
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
export class Feed implements Eventful<FeedEvents>, SnapshotExpecter, Resource {
	private readonly dispatcher = new Dispatcher<FeedEvents>();
	readonly events = this.dispatcher.events;

	/** As the server last said, with every change on its way shown over it (see `expect`). */
	snapshot: Snapshot | null = null;
	/**
	 * Set once the server has stayed unreachable for `offlineAfter`, so a
	 * stale page says so instead of lying.
	 */
	offline = false;
	/**
	 * What the server says when a newer splates has moved the repo's records on,
	 * past what it understands: it refuses until it is updated.
	 */
	outdated: string | null = null;
	/**
	 * What the server says when it has no project to show: none added yet,
	 * or the one the address names is gone.
	 */
	missing: string | null = null;

	private stream: LiveStream | null = null;
	/** The changes on their way, in the order made (see `expect`). */
	private expected: Expected[] = [];
	/** As the server last said, without what is on its way. */
	private recorded: Snapshot | null = null;
	/** How many snapshot reads have started, so a read knows which writes it follows. */
	private reads = 0;
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
		this.expected = [];
	}

	/**
	 * Shows `expectation`, how a write turns the snapshot as the server last
	 * said it into what it will say, at once, while `write`, the request that
	 * makes it, is on its way, so a board action shows at the click rather
	 * than on the refetch the server's push brings. It stays over whatever
	 * the server says meanwhile, and goes once `write` lands and the server's
	 * snapshot holds it, or once a snapshot read after it lands answers: the
	 * server marks the repo moved before it answers a write, so that read is
	 * fresh. Refused, it goes at once and the promise rejects with why, for
	 * the caller to say. `ConversationFeed.expect` does the same for a
	 * conversation, so the two read alike.
	 */
	async expect(
		expectation: (snapshot: Snapshot) => Snapshot,
		write: Promise<unknown>,
	): Promise<void> {
		const expected: Expected = { patch: expectation, landed: null };
		this.expected = [...this.expected, expected];
		this.show(this.recorded);
		try {
			await write;
		} catch (error) {
			this.unexpect(expected);
			throw error;
		}
		expected.landed = this.reads;
		if (this.recorded === null || holds(this.recorded, expectation)) {
			this.unexpect(expected);
		}
	}

	/** Stops showing `expected`. */
	private unexpect(expected: Expected): void {
		this.expected = this.expected.filter((each) => each !== expected);
		this.show(this.recorded);
	}

	/** Shows `recorded`, the server's word, with every change on its way over it. */
	private show(recorded: Snapshot | null): void {
		this.recorded = recorded;
		this.snapshot =
			recorded === null
				? null
				: this.expected.reduce((shown, { patch }) => patch(shown), recorded);
		this.dispatcher.dispatch("changed");
	}

	private async load(): Promise<void> {
		const read = this.reads++;
		try {
			const response = await fetch(scoped("/api/snapshot"));
			if (!response.ok) {
				const refusal = (await response.json().catch(() => null)) as {
					reason?: string;
					message?: string;
				} | null;
				if (refusal?.reason === "not_found") {
					this.reached({ missing: refusal.message ?? "" });
					return;
				}
				if (refusal?.reason !== "outdated") {
					throw new Error(`snapshot: ${response.status}`);
				}
				this.reached({ outdated: refusal.message ?? "" });
				return;
			}
			const snapshot = (await response.json()) as Snapshot;
			// What landed before this read began, or this read holds, is the
			// server's word now.
			this.expected = this.expected.filter(
				(each) =>
					each.landed === null ||
					(each.landed > read && !holds(snapshot, each.patch)),
			);
			this.reached({ snapshot, outdated: null, missing: null });
		} catch {
			// The last good snapshot stays on screen: a page that empties itself
			// because one poll failed is worse than one that admits it is stale.
			this.lost();
		}
	}

	/** Starts counting down to `offline`, unless already counting. */
	private lost(): void {
		// Its stream is refused too, by a server that answers.
		if (this.offline || this.unreachable !== null || this.missing !== null) {
			return;
		}
		this.unreachable = this.timer.setTimeout(() => {
			this.unreachable = null;
			this.set({ offline: true });
		}, this.offlineAfter);
	}

	/** The server answered with `next`: the countdown to `offline` stops. */
	private reached(
		next: Partial<Pick<Feed, "snapshot" | "outdated" | "missing">>,
	): void {
		this.unreachable?.dispose();
		this.unreachable = null;
		this.set({ ...next, offline: false });
	}

	private set(
		next: Partial<Pick<Feed, "snapshot" | "offline" | "outdated" | "missing">>,
	): void {
		const { snapshot, ...rest } = next;
		Object.assign(this, rest);
		if (snapshot === undefined) {
			this.dispatcher.dispatch("changed");
		} else {
			this.show(snapshot);
		}
	}
}

/** A change `expect` shows: how, and when its write landed. */
interface Expected {
	patch: (snapshot: Snapshot) => Snapshot;
	/** `reads` as its write landed; null while it is on its way. */
	landed: number | null;
}

/** Whether `snapshot` already holds what `patch` would change of it. */
function holds(
	snapshot: Snapshot,
	patch: (snapshot: Snapshot) => Snapshot,
): boolean {
	return same(patch(snapshot), snapshot);
}

/**
 * Whether `left` and `right` hold the same, by value. A patch keeps what it leaves
 * alone as it was, so most of a snapshot compares by reference.
 */
function same(left: unknown, right: unknown): boolean {
	if (left === right) {
		return true;
	}
	if (
		typeof left !== "object" ||
		typeof right !== "object" ||
		left === null ||
		right === null ||
		Array.isArray(left) !== Array.isArray(right)
	) {
		return false;
	}
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every((key) =>
			same(
				(left as Record<string, unknown>)[key],
				(right as Record<string, unknown>)[key],
			),
		)
	);
}
