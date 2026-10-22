import { PULSE } from "@stringsync/splates-server/server/browser";
import type { Resource } from "webappwiz/disposable";
import { Debouncer, SystemTimer, type Timer } from "webappwiz/time";
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
 * An `EventSource` that opens again once it has heard nothing, not even the
 * server's pulse, for two pulses. Across a sleep a stream can sit open with
 * no error and no news, and the page would miss every change until a reload;
 * `open` runs again on each new one, to read afresh what moved meanwhile.
 * It opens again at once when `wakes` says the page woke.
 */
export class LiveStream implements Resource {
	private source: EventSource | null = null;
	private opened = false;
	private readonly silence: Debouncer;
	private readonly unlisten: () => void;

	constructor(
		private readonly url: string,
		private readonly handlers: StreamHandlers,
		timer: Timer = new SystemTimer(),
		wakes: Wakes = WAKES,
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
		this.unlisten();
		this.silence.dispose();
		this.source?.close();
		this.source = null;
	}

	private open(): void {
		this.source?.close();
		const source = new EventSource(this.url);
		this.source = source;
		const heard = () => this.silence.call(() => this.reopen());
		const { message, open, error, named = {} } = this.handlers;
		source.onmessage = (event: MessageEvent<string>) => {
			heard();
			message(event);
		};
		source.onopen = () => {
			heard();
			open?.(this.opened);
			this.opened = true;
		};
		source.onerror = () => error?.();
		source.addEventListener("pulse", heard);
		for (const [name, listener] of Object.entries(named)) {
			source.addEventListener(name, (event: MessageEvent<string>) => {
				heard();
				listener(event);
			});
		}
		// Even one that never opens is tried again.
		heard();
	}
}
