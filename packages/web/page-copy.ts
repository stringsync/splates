import type { Resource } from "webappwiz/disposable";
import { Duration, type Timer } from "webappwiz/time";
import type { PageCopies } from "./page-copies";

/**
 * How long a copy waits to be kept after it last changes, so a burst of
 * changes, as a stream brings, is cloned into the store once.
 */
export const KEEP_AFTER = Duration.secs(2);

/** The longest a copy waits to be kept through changes that never pause, as an agent at work brings. */
export const KEEP_WITHIN = Duration.secs(30);

/** The shape of every value a `PageCopy` keeps; bump it when one changes. */
const PAGE_DATA_VERSION = 1;

/**
 * One thing the page keeps a copy of, under `key` in `copies`, stamped with
 * its data version rather than the frontend build, so an update can draw it
 * while the server reads afresh. A page with another data version waits for
 * the server instead. Dispose to keep what is pending.
 */
export class PageCopy<T> implements Resource {
	private pending: (() => T) | null = null;
	private waiting: Resource | null = null;
	private deadline: Resource | null = null;
	private readonly hide = () => {
		if (document.visibilityState === "hidden") {
			this.flush();
		}
	};

	constructor(
		private readonly copies: PageCopies,
		private readonly key: string,
		private readonly timer: Timer,
		private readonly version: number = PAGE_DATA_VERSION,
	) {
		// A page sent to the background may be dropped without a word.
		document.addEventListener("visibilitychange", this.hide);
	}

	/** What this data version last kept, or null. */
	async load(): Promise<T | null> {
		const kept = (await this.copies.load(this.key).catch(() => null)) as {
			version?: unknown;
			build?: unknown;
			value?: T;
		} | null;
		// Build-stamped copies predate data versions and have the initial shape.
		const version =
			kept?.version ??
			(typeof kept?.build === "string" ? PAGE_DATA_VERSION : null);
		return version === this.version && kept?.value !== undefined
			? kept.value
			: null;
	}

	/**
	 * Keeps what `value` makes, once `KEEP_AFTER` has passed with no change
	 * or `KEEP_WITHIN` since the first: a function, so a change kept again
	 * meanwhile is made once, at the end.
	 */
	keep(value: () => T): void {
		this.pending = value;
		this.waiting?.dispose();
		this.waiting = this.timer.setTimeout(() => this.flush(), KEEP_AFTER);
		this.deadline ??= this.timer.setTimeout(() => this.flush(), KEEP_WITHIN);
	}

	dispose(): void {
		document.removeEventListener("visibilitychange", this.hide);
		this.flush();
	}

	private flush(): void {
		this.waiting?.dispose();
		this.waiting = null;
		this.deadline?.dispose();
		this.deadline = null;
		const pending = this.pending;
		this.pending = null;
		if (pending !== null) {
			this.copies.save(this.key, { version: this.version, value: pending() });
		}
	}
}
