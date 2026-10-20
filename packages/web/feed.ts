import type { Snapshot } from "@stringsync/splates-server/tasks";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import { scoped } from "./api";
import { EARLY_READS } from "./early-reads";
import type { SnapshotExpecter } from "./expecting";
import { LiveStream } from "./live-stream";
import type { PageCopy } from "./page-copy";

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
	/**
	 * What the server says when this project's records could not move to the
	 * format it reads: it put them back, and refuses them until a retry passes.
	 */
	failed: string | null = null;
	/**
	 * Whether `snapshot` is the one `seed` gave, standing in until the
	 * project's own arrives.
	 */
	seeded = false;

	private stream: LiveStream | null = null;
	/** The changes on their way, in the order made (see `expect`). */
	private expected: Expected[] = [];
	/** As the server last said, without what is on its way. */
	private recorded: Snapshot | null = null;
	/** How many snapshot reads have started, so a read knows which writes it follows. */
	private reads = 0;
	/** The snapshot read in flight, if any. */
	private loading: Promise<void> | null = null;
	/** Whether a call came while it was, so another read follows. */
	private trailing = false;
	/** Counting down to `offline` while the server is unreachable. */
	private unreachable: Resource | null = null;

	private readonly offlineAfter: Duration;
	private readonly timer: Timer;
	private readonly project: string | null;
	private readonly copy: PageCopy<Snapshot> | null;

	constructor({
		offlineAfter = OFFLINE_AFTER,
		timer = new SystemTimer(),
		copy = null,
		project = null,
	}: {
		offlineAfter?: Duration;
		timer?: Timer;
		/** The last snapshot kept, which the page draws from until the server answers. */
		copy?: PageCopy<Snapshot> | null;
		/**
		 * The project it reads, a slug or "" for the focused one, whatever the
		 * address goes on to name; the address's own by default.
		 */
		project?: string | null;
	} = {}) {
		this.offlineAfter = offlineAfter;
		this.timer = timer;
		this.project = project;
		this.copy = copy;
	}

	start(): void {
		// React runs a mount effect twice in StrictMode, and a second stream would
		// leak the first.
		if (this.stream !== null) {
			return;
		}
		this.stream = new LiveStream(scoped("/events", this.project), {
			message: () => void this.load(),
			// Back after the stream dropped, what moved meanwhile was never said.
			open: (again) => (again ? void this.load() : this.reached({})),
			// The stream reconnects on its own, so this is a notice rather than
			// an error to recover from: `open` clears it when the server comes
			// back.
			error: () => this.lost(),
		});
		void this.paint();
		void this.load();
	}

	/** Reads the snapshot again now, as after a retry the server took. */
	reload(): Promise<void> {
		return this.load();
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
		this.copy?.dispose();
	}

	/**
	 * Shows the snapshot last kept, unless the server has said something
	 * since. Over a seed, it gives the rest of the project, under the seed's
	 * tasks, which are newer.
	 */
	private async paint(): Promise<void> {
		const kept = this.copy === null ? null : await this.copy.load();
		if (
			kept === null ||
			(this.recorded !== null && !this.seeded) ||
			this.missing !== null ||
			this.outdated !== null
		) {
			return;
		}
		const seed = this.seeded ? this.recorded : null;
		this.seeded = false;
		this.show(
			seed === null
				? kept
				: { ...kept, tasks: seed.tasks, laneNames: seed.laneNames },
		);
	}

	/**
	 * Shows `snapshot`, made from what the page already holds of the
	 * project, until the server's own arrives, so a project the page has not
	 * read yet draws at once. With `whole`, it is one the server gave, under
	 * another address, and stands for all of the project. Ignored once it has
	 * a snapshot.
	 */
	seed(snapshot: Snapshot, { whole = false }: { whole?: boolean } = {}): void {
		if (this.recorded !== null) {
			return;
		}
		this.seeded = !whole;
		this.show(snapshot);
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

	/**
	 * Reads the snapshot, one read at a time: a call while one is in flight
	 * leaves a single trailing read, which asks after the move that called it.
	 */
	private load(): Promise<void> {
		if (this.loading !== null) {
			this.trailing = true;
			return this.loading;
		}
		const loading = (async () => {
			do {
				this.trailing = false;
				await this.read();
			} while (this.trailing && this.stream !== null);
		})().finally(() => {
			this.loading = null;
		});
		this.loading = loading;
		return loading;
	}

	private async read(): Promise<void> {
		const read = this.reads++;
		try {
			const response = await EARLY_READS.fetch(
				scoped("/api/snapshot", this.project),
			);
			if (!response.ok) {
				const refusal = (await response.json().catch(() => null)) as {
					reason?: string;
					message?: string;
				} | null;
				if (refusal?.reason === "not_found") {
					// Nothing of a project the server has not got to stand in for.
					const seeded = this.seeded ? { snapshot: null } : {};
					this.seeded = false;
					this.reached({ missing: refusal.message ?? "", ...seeded });
					return;
				}
				if (refusal?.reason === "migration_failed") {
					// Nothing of records the server will not read stays on screen.
					this.seeded = false;
					this.reached({ failed: refusal.message ?? "", snapshot: null });
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
			this.seeded = false;
			this.reached({ snapshot, outdated: null, missing: null, failed: null });
			this.copy?.keep(() => snapshot);
		} catch {
			// The last good snapshot stays on screen: a page that empties itself
			// because one poll failed is worse than one that admits it is stale.
			this.lost();
		}
	}

	/** Starts counting down to `offline`, unless already counting. */
	private lost(): void {
		// Its stream is refused too, by a server that answers.
		if (
			this.offline ||
			this.unreachable !== null ||
			this.missing !== null ||
			this.failed !== null
		) {
			return;
		}
		this.unreachable = this.timer.setTimeout(() => {
			this.unreachable = null;
			this.set({ offline: true });
		}, this.offlineAfter);
	}

	/** The server answered with `next`: the countdown to `offline` stops. */
	private reached(
		next: Partial<Pick<Feed, "snapshot" | "outdated" | "missing" | "failed">>,
	): void {
		this.unreachable?.dispose();
		this.unreachable = null;
		this.set({ ...next, offline: false });
	}

	private set(
		next: Partial<
			Pick<Feed, "snapshot" | "offline" | "outdated" | "missing" | "failed">
		>,
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
