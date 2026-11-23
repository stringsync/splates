import type { RunLog } from "@splates/server/rigs/browser";
import type { Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";

type LogEvents = { changed: undefined };

/** How often an open run's log is read again. */
export const LOG_EVERY_MS = 1000;

/** The most log lines the page keeps of a run. */
const LOG_LINES = 500;

/** Where a run's log is read from. */
export interface RunLogApi {
	runLog(id: string, after: number): Promise<RunLog>;
}

/**
 * Run `id`'s log as it comes: `watch` reads it every second, asking only
 * for the lines after the last it has, and `lines` holds the latest 500.
 */
export class RunLogReader implements Eventful<LogEvents>, Resource {
	readonly #dispatcher = new Dispatcher<LogEvents>();
	readonly events = this.#dispatcher.events;
	lines: { n: number; text: string }[] = [];
	#after = 0;

	constructor(
		private readonly api: RunLogApi,
		private readonly id: string,
	) {}

	#timer: ReturnType<typeof setInterval> | null = null;

	/** Reads the log now and every second, until the watch or the reader is disposed. */
	watch(every = LOG_EVERY_MS): Resource {
		this.dispose();
		const look = async () => {
			try {
				const log = await this.api.runLog(this.id, this.#after);
				if (this.#timer === null) {
					return;
				}
				this.#after = log.last;
				if (log.lines.length > 0) {
					this.lines = [...this.lines, ...log.lines].slice(-LOG_LINES);
					this.#dispatcher.dispatch("changed");
				}
			} catch {
				// Gone or out of reach: the last lines stay shown.
			}
		};
		this.#timer = setInterval(() => void look(), every);
		void look();
		return { dispose: () => this.dispose() };
	}

	dispose(): void {
		if (this.#timer !== null) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}
}
