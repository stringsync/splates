import { PULSE } from "@stringsync/splates-server/server/browser";
import type { Resource } from "webappwiz/disposable";
import { Debouncer, Duration, SystemTimer, type Timer } from "webappwiz/time";
import { WAKES, type Wakes } from "./wakes";

/** What a stream's events go to, each named event by its name. */
export interface StreamHandlers {
	message: (event: MessageEvent<string>) => void;
	/**
	 * On each open, `again` once it has opened before, when what moved while
	 * it was away was never said.
	 */
	open?: (again: boolean) => void;
	error?: () => void;
	/**
	 * When it gives up the stream it had, gone silent or the page woken, before
	 * it opens another: until that one opens and is read, what it said may be
	 * stale.
	 */
	dropped?: () => void;
	named?: Record<string, (event: MessageEvent<string>) => void>;
}

/**
 * Events a stream hands on at once before the rest of a burst waits, and how
 * long it waits. A stream opening says every conversation again, hundreds of
 * events in a second, each of which would redraw the page: held to `BATCH`
 * apiece, they run together, which the page draws once.
 */
const BURST = 8;
const BATCH = Duration.ms(50);

/** How long a stream the browser closed for good waits before it opens again. */
// About what the browser waits itself on a stream it keeps: a proxy's error
// answer, as a tunnel gives while `splates server` is down, closes it for good.
export const RETRY = Duration.secs(3);

/**
 * Use in place of an `EventSource` for a stream the page must not lose: it
 * opens again after two pulses of silence, at once when `wakes` says the page
 * woke, and soon after the browser closes it. `open` runs again on each new
 * one, to read afresh what moved meanwhile; `dispose` closes it.
 */
// Across a sleep a stream can sit open with no error and no news, and the
// page would miss every change until a reload.
export class LiveStream implements Resource {
	private source: EventSource | null = null;
	private opened = false;
	private readonly silence: Debouncer;
	/** Events past a burst, waiting to run together. */
	private waiting: (() => void)[] = [];
	private flushing: Resource | null = null;
	private calm: Resource | null = null;
	private recent = 0;
	/** Waiting to open again after the browser gave up on the stream. */
	private retrying: Resource | null = null;
	private readonly unlisten: () => void;

	constructor(
		private readonly url: string,
		private readonly handlers: StreamHandlers,
		private readonly timer: Timer = new SystemTimer(),
		private readonly wakes: Wakes = WAKES,
	) {
		this.silence = new Debouncer(timer, PULSE.multiply(2));
		this.unlisten = wakes.events.on("woke", () => this.reopen());
		this.open();
	}

	/** Gives up the stream it has for a new one now, as on a wake or a retry. */
	reopen(): void {
		if (this.source === null) {
			return;
		}
		this.handlers.dropped?.();
		this.open();
	}

	dispose(): void {
		this.flushing?.dispose();
		this.calm?.dispose();
		this.retrying?.dispose();
		this.waiting = [];
		this.unlisten();
		this.silence.dispose();
		this.source?.close();
		this.source = null;
	}

	/** Runs `deliver` now, or with the rest of a burst once the stream has said `BURST` events in a `BATCH`. */
	private deliver(deliver: () => void): void {
		if (this.flushing === null && this.recent < BURST) {
			this.recent++;
			this.calm ??= this.timer.setTimeout(() => this.settle(), BATCH);
			deliver();
			return;
		}
		this.waiting.push(deliver);
		this.flushing ??= this.timer.setTimeout(() => this.flush(), BATCH);
	}

	/** Runs what waited, in the order it came. */
	private flush(): void {
		this.flushing?.dispose();
		this.flushing = null;
		const waiting = this.waiting;
		this.waiting = [];
		if (waiting.length === 0) {
			return;
		}
		for (const deliver of waiting) {
			deliver();
		}
		// Still a burst: the next events wait too, until a batch passes calm.
		this.calm?.dispose();
		this.calm = this.timer.setTimeout(() => this.settle(), BATCH);
	}

	private settle(): void {
		this.calm = null;
		this.recent = 0;
	}

	private open(): void {
		this.retrying?.dispose();
		this.retrying = null;
		this.source?.close();
		const source = new EventSource(this.url);
		this.source = source;
		const waiting = () => this.silence.call(() => this.reopen());
		const heard = () => {
			this.wakes.heard();
			waiting();
		};
		const { message, open, error, named = {} } = this.handlers;
		source.onmessage = (event: MessageEvent<string>) => {
			heard();
			this.deliver(() => message(event));
		};
		source.onopen = () => {
			heard();
			// What this stream said before is older than the listing `open` asks for.
			this.flush();
			open?.(this.opened);
			this.opened = true;
		};
		source.onerror = () => {
			error?.();
			// `EventSource.CLOSED`, spelled out for a stand-in that lacks it.
			if (source.readyState === 2 && this.retrying === null) {
				this.retrying = this.timer.setTimeout(() => {
					this.retrying = null;
					this.reopen();
				}, RETRY);
			}
		};
		source.addEventListener("pulse", heard);
		for (const [name, listener] of Object.entries(named)) {
			source.addEventListener(name, (event: MessageEvent<string>) => {
				heard();
				this.deliver(() => listener(event));
			});
		}
		// Even one that never opens is tried again.
		waiting();
	}
}
