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

/**
 * One thing the page keeps a copy of, under `key` in `copies`, stamped with
 * the build that kept it, so a page of another build, which may read it
 * otherwise, waits for the server instead. Dispose to keep what is pending.
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
		private readonly build: string = pageBuild(),
	) {
		// A page sent to the background may be dropped without a word.
		document.addEventListener("visibilitychange", this.hide);
	}

	/** What this build last kept, or null. */
	async load(): Promise<T | null> {
		const kept = (await this.copies.load(this.key).catch(() => null)) as {
			build?: unknown;
			value?: T;
		} | null;
		return kept?.build === this.build && kept.value !== undefined
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
			this.copies.save(this.key, { build: this.build, value: pending() });
		}
	}
}

/** The build of the page running, by the stamp `splates server` put on its script. */
function pageBuild(): string {
	const script = document.querySelector<HTMLScriptElement>(
		'script[src^="/main.js"]',
	);
	return script === null
		? ""
		: (new URL(script.src).searchParams.get("v") ?? "");
}
