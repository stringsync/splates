import type { RunnersReport } from "@stringsync/splates-server/spend";
import { WindowBackgroundObserver } from "webappwiz/browser";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, SystemTimer } from "webappwiz/time";
import { removeWorker, runners } from "./api";

export type RunnersViewEvents = { changed: undefined };

/** What the history's bars are each: a day or a month. */
export type RunnerPer = "day" | "month";

/** How often the page asks what runners cost, while in front. */
const EVERY = Duration.secs(15);

/**
 * Every runner ever made and what they cost, asked every few seconds while
 * the Billing page is in front, so a runner up now and its jobs move as it
 * runs, and the runners asked to stop.
 */
export class RunnersView implements Eventful<RunnersViewEvents> {
	private readonly dispatcher = new Dispatcher<RunnersViewEvents>();
	readonly events = this.dispatcher.events;

	/** Null before the first answer. */
	report: RunnersReport | null = null;
	/** Why the last reading failed, or null. */
	error: string | null = null;
	/** The runners asked to stop that the report still has up. */
	stopping: ReadonlySet<string> = new Set();
	/** Whether the history shows days or months. */
	per: RunnerPer = "day";
	/** The day or month whose split by task shows; null for the latest. */
	picked: string | null = null;

	/** Whether the list shows every runner rather than the newest few. */
	all = false;

	/** Lists every runner. */
	showAll(): void {
		this.all = true;
		this.dispatcher.dispatch("changed");
	}

	/** Shows the history by `per`, its latest picked. */
	showPer(per: RunnerPer): void {
		this.per = per;
		this.picked = null;
		this.dispatcher.dispatch("changed");
	}

	/** Shows who `period`'s cost went to. */
	pick(period: string): void {
		this.picked = period;
		this.dispatcher.dispatch("changed");
	}

	/** Reads it now and every few seconds while the page is in front, until disposed. */
	watch(): Resource {
		const observer = new WindowBackgroundObserver();
		const ask = () => {
			if (!observer.isBackgrounded()) {
				void this.read();
			}
		};
		ask();
		observer.events.on("change", ask);
		const tick = new SystemTimer().setInterval(ask, EVERY);
		return {
			dispose: () => {
				tick.dispose();
				observer.dispose();
			},
		};
	}

	/**
	 * Stops runner `id` as the Runners page's Stop does: at once with no job
	 * on it, else once those on it end. Shows it stopping at once, or puts
	 * it back and throws the refusal.
	 */
	async stop(id: string): Promise<void> {
		this.stopping = new Set([...this.stopping, id]);
		this.dispatcher.dispatch("changed");
		try {
			await removeWorker(id, false);
		} catch (caught) {
			this.stopping = new Set([...this.stopping].filter((each) => each !== id));
			this.dispatcher.dispatch("changed");
			throw caught;
		}
		await this.read();
	}

	private async read(): Promise<void> {
		try {
			const report = await runners();
			const up = new Set(
				report.runners
					.filter((runner) => runner.until === null)
					.map((runner) => runner.id),
			);
			this.report = report;
			this.stopping = new Set([...this.stopping].filter((id) => up.has(id)));
			this.error = null;
		} catch (caught) {
			this.error = (caught as Error).message;
		}
		this.dispatcher.dispatch("changed");
	}
}
