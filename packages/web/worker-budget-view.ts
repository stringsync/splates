import type { WorkerBudgetReport } from "@stringsync/splates-server/workers";
import { WindowBackgroundObserver } from "webappwiz/browser";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, SystemTimer } from "webappwiz/time";
import { workerBudget } from "./worker-budget-api";

export type WorkerBudgetViewEvents = { changed: undefined };

/** How often the page asks what made workers cost, while in front. */
const EVERY = Duration.secs(15);

/**
 * The worker budget, asked every few seconds while the Budget page is in
 * front, so spend moves as made workers run.
 */
export class WorkerBudgetView implements Eventful<WorkerBudgetViewEvents> {
	private readonly dispatcher = new Dispatcher<WorkerBudgetViewEvents>();
	readonly events = this.dispatcher.events;

	/** Undefined before the first answer, null when there is no budget. */
	report: WorkerBudgetReport | null | undefined = undefined;
	/** Why the last reading failed, or null. */
	error: string | null = null;

	/** Reads it now and every few seconds while the page is in front, until disposed. */
	watch(): Resource {
		const observer = new WindowBackgroundObserver();
		const ask = () => {
			if (!observer.isBackgrounded()) {
				workerBudget().then(
					(read) => this.set(read),
					(caught: Error) => {
						this.error = caught.message;
						this.dispatcher.dispatch("changed");
					},
				);
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
	 * Shows `expect` of it at once, then the server's answer to `send`, or
	 * puts it back and throws the refusal.
	 */
	async change(
		expect: (report: WorkerBudgetReport) => WorkerBudgetReport,
		send: () => Promise<WorkerBudgetReport>,
	): Promise<void> {
		const before = this.report;
		if (before != null) {
			this.set(expect(before));
		}
		try {
			this.set(await send());
		} catch (caught) {
			this.report = before;
			this.dispatcher.dispatch("changed");
			throw caught;
		}
	}

	private set(report: WorkerBudgetReport | null): void {
		this.report = report;
		this.error = null;
		this.dispatcher.dispatch("changed");
	}
}
