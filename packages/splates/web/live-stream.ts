import type { Resource } from "webappwiz/disposable";
import { Debouncer, SystemTimer, type Timer } from "webappwiz/time";
import { PULSE } from "../pulse";

/** What a stream's events go to, each named event by its name. */
export interface StreamHandlers {
	message: (event: MessageEvent<string>) => void;
	/**
	 * On each open, `again` once it has opened before, when what moved while
	 * it was away was never said.
	 */
	open?: (again: boolean) => void;
	error?: () => void;
	named?: Record<string, (event: MessageEvent<string>) => void>;
}

/**
 * An `EventSource` that opens again once it has heard nothing, not even the
 * server's pulse, for two pulses. Across a sleep a stream can sit open with
 * no error and no news, and the page would miss every change until a reload;
 * `open` runs again on each new one, to read afresh what moved meanwhile.
 */
export class LiveStream implements Resource {
	private source: EventSource | null = null;
	private opened = false;
	private readonly silence: Debouncer;

	constructor(
		private readonly url: string,
		private readonly handlers: StreamHandlers,
		timer: Timer = new SystemTimer(),
	) {
		this.silence = new Debouncer(timer, PULSE.multiply(2));
		this.open();
	}

	dispose(): void {
		this.silence.dispose();
		this.source?.close();
		this.source = null;
	}

	private open(): void {
		this.source?.close();
		const source = new EventSource(this.url);
		this.source = source;
		const heard = () => this.silence.call(() => this.open());
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
